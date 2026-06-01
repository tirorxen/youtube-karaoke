/**
 * Web Audio AudioEngine — 把 worklets 串成 KTV graph，支援 crossfade 無縫切換。
 *
 *   trackA (即時三頻段版) → sourceA → gainA ─┐
 *                                              ├─→ vocal → pitch → mixer → destination
 *   trackB (demucs instrumental) → sourceB → gainB ─┘                ↑
 *                                                                    │
 *   getUserMedia mic → micSource ────────────────────────────────────┘
 *
 * **slot 角色固定**（Hotfix #6）：
 *   - slotA / gainA / audioElementA 永遠是「Track-A」(即時版)
 *   - slotB / gainB / audioElementB 永遠是「Track-B」(demucs 版)
 *   - crossfade 只動 gain，不換 slot 角色
 *   - 載入新歌：呼叫 resetActiveTrack() → gainA=1, gainB=0 重設
 *
 * 為什麼這樣設計：Web Audio spec 禁止對同一個 HTMLMediaElement 二次
 * createMediaElementSource。如果 slot 角色翻轉，下一首歌會嘗試把 audioA
 * 接到 slotB（已綁 audioB），createMediaElementSource(audioA) 拋 InvalidStateError。
 */

import type {
  KaraokeSettings,
  GenderPreset,
} from "../settings/KaraokeSettings";
import {
  effectiveSemitones,
  guideVocalLevel,
  micGain,
  vocalRemovalLevel,
} from "../settings/KaraokeSettings";

const VOCAL_URL = new URL("./worklets/vocal-remover-processor.ts", import.meta.url).href;
const PITCH_URL = new URL("./worklets/pitch-shifter-processor.ts", import.meta.url).href;
const MIXER_URL = new URL("./worklets/mixer-processor.ts", import.meta.url).href;

interface TrackSlot {
  element: HTMLMediaElement | null;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;

  /** Track-A：即時三頻段版（普通 m4a，原曲）。永遠對應同一個 audio element。 */
  private trackA: TrackSlot = { element: null, source: null, gain: null };
  /** Track-B：demucs ML 分離後的 instrumental（no_vocals，伴奏）。 */
  private trackB: TrackSlot = { element: null, source: null, gain: null };
  /** Track-C：demucs ML 分離後的 vocals（人聲，導唱混音用）。 */
  private trackC: TrackSlot = { element: null, source: null, gain: null };

  /**
   * demucs 雙軌模式旗標：
   *   - false（三頻段模式）：trackA=1 走 vocalNode；導唱值 → vocalNode guide 參數
   *   - true（demucs 模式）：trackA=0、trackB(伴奏)=1、trackC(人聲)=導唱值
   *     導唱值改成直接控制 trackC.gain = 真・KTV 導唱（0%=純伴奏，100%=原曲）
   */
  private demucsMode = false;

  private micSource: MediaStreamAudioSourceNode | null = null;
  private attachedMicStream: MediaStream | null = null;

  private vocalNode: AudioWorkletNode | null = null;
  private pitchNode: AudioWorkletNode | null = null;
  private mixerNode: AudioWorkletNode | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    await Promise.all([
      this.ctx.audioWorklet.addModule(VOCAL_URL),
      this.ctx.audioWorklet.addModule(PITCH_URL),
      this.ctx.audioWorklet.addModule(MIXER_URL),
    ]);
    this.vocalNode = new AudioWorkletNode(this.ctx, "vocal-remover-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
    });
    this.pitchNode = new AudioWorkletNode(this.ctx, "pitch-shifter-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
    });
    this.mixerNode = new AudioWorkletNode(this.ctx, "mixer-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // 三個 gain 先建好（element 之後 attach）
    this.trackA.gain = this.ctx.createGain();
    this.trackB.gain = this.ctx.createGain();
    this.trackC.gain = this.ctx.createGain();
    this.trackA.gain.gain.value = 1;   // 原曲（三頻段即時版）
    this.trackB.gain.gain.value = 0;   // demucs 伴奏（no_vocals）
    this.trackC.gain.gain.value = 0;   // demucs 人聲（vocals，導唱用）

    // Track-A 走三頻段 vocal remover；Track-B/C 已是 demucs 乾淨分離軌
    // → bypass vocalNode 直連 pitchNode（避免對乾淨伴奏又做 L-R cancellation）。
    // pitchNode numberOfInputs=1，三條連到同一個 input 0 → Web Audio 自動相加。
    this.trackA.gain.connect(this.vocalNode);
    this.vocalNode.connect(this.pitchNode, 0, 0);
    this.trackB.gain.connect(this.pitchNode, 0, 0);
    this.trackC.gain.connect(this.pitchNode, 0, 0);
    this.pitchNode.connect(this.mixerNode, 0, 0);
    this.mixerNode.connect(this.ctx.destination);
  }

  async resumeIfNeeded(): Promise<void> {
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume();
  }

  context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * 把 audio element A（即時版）接到 Track-A。
   * 對同一個 element idempotent；不同 element 來則拒絕（spec 限制）。
   */
  attachPrimary(media: HTMLMediaElement): void {
    if (!this.ctx) throw new Error("AudioEngine.init() 尚未呼叫");
    this.attachToTrack(this.trackA, media);
  }

  /**
   * 把 audio element B（demucs instrumental）接到 Track-B。
   * 對同一個 element idempotent。
   */
  attachSecondary(media: HTMLMediaElement): void {
    if (!this.ctx) throw new Error("AudioEngine.init() 尚未呼叫");
    this.attachToTrack(this.trackB, media);
  }

  /**
   * 把 audio element C（demucs vocals 人聲）接到 Track-C。
   * 導唱混音用：gain = guideVocalLevel。對同一個 element idempotent。
   */
  attachVocals(media: HTMLMediaElement): void {
    if (!this.ctx) throw new Error("AudioEngine.init() 尚未呼叫");
    this.attachToTrack(this.trackC, media);
  }

  /** demucs 模式是否啟用（前端決定要不要把導唱 chip 接到 trackC）。 */
  isDemucsMode(): boolean {
    return this.demucsMode;
  }

  private attachToTrack(slot: TrackSlot, media: HTMLMediaElement): void {
    if (slot.element === media && slot.source) {
      // 同一個 element，不要二次 createMediaElementSource
      return;
    }
    if (slot.source) {
      try { slot.source.disconnect(); } catch { /* ignore */ }
      slot.source = null;
    }
    slot.source = this.ctx!.createMediaElementSource(media);
    slot.source.connect(slot.gain!);
    slot.element = media;
  }

  /**
   * Crossfade gainA → 0, gainB → 1（legacy：只切伴奏，不含人聲軌）。
   * **不翻轉 slot 角色**——slotA 仍是 Track-A、slotB 仍是 Track-B。
   * 新流程請改用 crossfadeToDemucs()。
   */
  crossfadeToSecondary(durationMs: number = 200): void {
    if (!this.ctx || !this.trackA.gain || !this.trackB.gain) return;
    const now = this.ctx.currentTime;
    const end = now + durationMs / 1000;
    this.trackA.gain.gain.cancelScheduledValues(now);
    this.trackB.gain.gain.cancelScheduledValues(now);
    this.trackA.gain.gain.setValueAtTime(this.trackA.gain.gain.value, now);
    this.trackB.gain.gain.setValueAtTime(this.trackB.gain.gain.value, now);
    this.trackA.gain.gain.linearRampToValueAtTime(0, end);
    this.trackB.gain.gain.linearRampToValueAtTime(1, end);
  }

  /**
   * ★ demucs 雙軌導唱模式 ★：原曲(A)→0、伴奏(B)→1、人聲(C)→guideLevel。
   * 切過去後 guideVocalLevel 直接控制人聲軌音量 = 真・KTV 導唱：
   *   - 導唱 0%  → 純伴奏（人聲軌靜音）
   *   - 導唱 100% → 伴奏 + 完整人聲 = 原曲
   *   - 導唱 30% → 伴奏 + 30% 人聲（跟唱參考）
   */
  crossfadeToDemucs(guideLevel: number, durationMs: number = 250): void {
    if (!this.ctx || !this.trackA.gain || !this.trackB.gain || !this.trackC.gain) return;
    this.demucsMode = true;
    const now = this.ctx.currentTime;
    const end = now + durationMs / 1000;
    const g = Math.max(0, Math.min(1, guideLevel));
    for (const slot of [this.trackA, this.trackB, this.trackC]) {
      slot.gain!.gain.cancelScheduledValues(now);
      slot.gain!.gain.setValueAtTime(slot.gain!.gain.value, now);
    }
    this.trackA.gain.gain.linearRampToValueAtTime(0, end);   // 原曲淡出
    this.trackB.gain.gain.linearRampToValueAtTime(1, end);   // 伴奏淡入
    this.trackC.gain.gain.linearRampToValueAtTime(g, end);   // 人聲到導唱值
  }

  /** Crossfade 切回三頻段原曲模式（A→1, B/C→0），離開 demucs 模式。 */
  crossfadeToPrimary(durationMs: number = 200): void {
    if (!this.ctx || !this.trackA.gain || !this.trackB.gain || !this.trackC.gain) return;
    this.demucsMode = false;
    const now = this.ctx.currentTime;
    const end = now + durationMs / 1000;
    for (const slot of [this.trackA, this.trackB, this.trackC]) {
      slot.gain!.gain.cancelScheduledValues(now);
      slot.gain!.gain.setValueAtTime(slot.gain!.gain.value, now);
    }
    this.trackA.gain.gain.linearRampToValueAtTime(1, end);
    this.trackB.gain.gain.linearRampToValueAtTime(0, end);
    this.trackC.gain.gain.linearRampToValueAtTime(0, end);
  }

  /**
   * 載入新歌之前呼叫：重設 gain 回到 Track-A 為主。
   * 不重新 createMediaElementSource（保持兩個 slot 永久綁定原本 element）。
   */
  resetActiveTrack(): void {
    if (!this.ctx) return;
    this.demucsMode = false;
    const now = this.ctx.currentTime;
    if (this.trackA.gain) {
      this.trackA.gain.gain.cancelScheduledValues(now);
      this.trackA.gain.gain.setValueAtTime(1, now);
    }
    if (this.trackB.gain) {
      this.trackB.gain.gain.cancelScheduledValues(now);
      this.trackB.gain.gain.setValueAtTime(0, now);
    }
    if (this.trackC.gain) {
      this.trackC.gain.gain.cancelScheduledValues(now);
      this.trackC.gain.gain.setValueAtTime(0, now);
    }
  }

  attachMicStream(stream: MediaStream): void {
    if (!this.ctx || !this.mixerNode) throw new Error("AudioEngine.init() 尚未呼叫");
    if (this.attachedMicStream === stream && this.micSource) return;
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* ignore */ }
      this.micSource = null;
    }
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.mixerNode, 0, 1);
    this.attachedMicStream = stream;
  }

  detachMic(): void {
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* ignore */ }
      this.micSource = null;
    }
    this.attachedMicStream = null;
  }

  applySettings(s: KaraokeSettings): void {
    const guide = guideVocalLevel(s);
    this.vocalNode?.port.postMessage({ type: "set-vocal-removal", value: vocalRemovalLevel(s) });
    this.vocalNode?.port.postMessage({ type: "set-guide-vocal", value: guide });
    // demucs 模式：導唱值改成直接控制人聲軌(C) 音量（vocalNode 那條已被 trackA.gain=0 靜音）。
    // 用 60ms 短斜坡避免 click。
    if (this.demucsMode && this.ctx && this.trackC.gain) {
      const now = this.ctx.currentTime;
      this.trackC.gain.gain.cancelScheduledValues(now);
      this.trackC.gain.gain.setValueAtTime(this.trackC.gain.gain.value, now);
      this.trackC.gain.gain.linearRampToValueAtTime(guide, now + 0.06);
    }
    this.pitchNode?.port.postMessage({
      type: "set-effective-semitones",
      value: effectiveSemitones(s),
    });
    this.mixerNode?.port.postMessage({ type: "set-mic-gain", value: micGain(s) });
    this.mixerNode?.port.postMessage({
      type: "set-mic-alignment-ms",
      value: s.micAlignmentMs,
      sampleRate: this.ctx?.sampleRate ?? 48000,
    });
  }

  reset(): void {
    this.vocalNode?.port.postMessage({ type: "reset" });
    this.pitchNode?.port.postMessage({ type: "reset" });
    this.mixerNode?.port.postMessage({ type: "reset" });
  }

  // ----- 向後相容 -----
  /** @deprecated 用 attachPrimary 取代 */
  attachMediaElement(media: HTMLMediaElement): void {
    this.attachPrimary(media);
  }
  /** @deprecated 沒用了；保留避免外部 code 炸 */
  getPrimaryMedia(): HTMLMediaElement | null {
    return this.trackA.element;
  }
  /** @deprecated */
  getSecondaryMedia(): HTMLMediaElement | null {
    return this.trackB.element;
  }

  async close(): Promise<void> {
    this.detachMic();
    for (const slot of [this.trackA, this.trackB, this.trackC]) {
      if (slot.source) {
        try { slot.source.disconnect(); } catch { /* ignore */ }
      }
      slot.source = null;
      slot.element = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.vocalNode = null;
    this.pitchNode = null;
    this.mixerNode = null;
    this.initPromise = null;
  }
}

export const audioEngine = new AudioEngine();

export function previewEffectiveSemitones(
  pitchSemitones: number,
  gender: GenderPreset
): number {
  const delta = gender === "MALE_TO_FEMALE" ? 5 : gender === "FEMALE_TO_MALE" ? -5 : 0;
  return Math.max(-12, Math.min(12, pitchSemitones + delta));
}
