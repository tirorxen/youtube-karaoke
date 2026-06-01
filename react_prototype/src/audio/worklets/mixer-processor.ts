/**
 * Mixer AudioWorkletProcessor — 把 mic input 混入 stereo BGM。
 *
 * 對應 Python `ktv/mixer.py::Mixer`。
 *
 * 兩個 input：
 *   inputs[0] = BGM stereo（vocal-remover → pitch-shifter 後傳入）
 *   inputs[1] = mic mono（getUserMedia）
 *
 * mic alignment 用 ring buffer：mic samples 寫入 ring，輸出時依
 * alignment 倒回讀，等於延遲補償。
 */

import type { MixerMessage } from "../types";

const RING_SECONDS = 1.0;

class MixerProcessor extends AudioWorkletProcessor {
  private micGain = 1.0;
  private alignmentSamples = 0;

  private ring: Float32Array;
  private writePos = 0;

  constructor() {
    super();
    this.ring = new Float32Array(Math.ceil(sampleRate * RING_SECONDS));
    this.port.onmessage = (e: MessageEvent<MixerMessage>) => {
      const msg = e.data;
      if (msg.type === "set-mic-gain") this.micGain = Math.max(0, Math.min(2, msg.value));
      else if (msg.type === "set-mic-alignment-ms") {
        this.alignmentSamples = Math.max(0, Math.floor((msg.value * sampleRate) / 1000));
      } else if (msg.type === "reset") {
        this.ring.fill(0);
        this.writePos = 0;
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _params: Record<string, Float32Array>
  ): boolean {
    const bgm = inputs[0];
    const mic = inputs[1];
    const out = outputs[0];

    const lOut = out[0];
    const rOut = out[1] ?? out[0];

    // 1) BGM pass-through
    if (bgm && bgm.length > 0) {
      const lIn = bgm[0];
      const rIn = bgm[1] ?? bgm[0];
      for (let i = 0; i < lOut.length; i++) {
        lOut[i] = lIn[i];
        rOut[i] = rIn[i];
      }
    } else {
      lOut.fill(0);
      rOut.fill(0);
    }

    // 2) push mic 到 ring
    if (mic && mic.length > 0 && mic[0].length > 0) {
      const ch = mic[0];
      const cap = this.ring.length;
      let w = this.writePos;
      for (let i = 0; i < ch.length; i++) {
        this.ring[w] = ch[i];
        w = (w + 1) % cap;
      }
      this.writePos = w;
    }

    // 3) 從 ring 讀對應 numFrames（依 alignmentSamples 倒推）
    const cap = this.ring.length;
    const numFrames = lOut.length;
    const totalLook = this.alignmentSamples + numFrames;
    if (totalLook <= cap) {
      let read = (this.writePos + cap - totalLook) % cap;
      const gain = this.micGain;
      for (let i = 0; i < numFrames; i++) {
        const m = this.ring[read] * gain;
        read = (read + 1) % cap;
        const l = lOut[i] + m;
        const r = rOut[i] + m;
        lOut[i] = l < -1 ? -1 : l > 1 ? 1 : l;
        rOut[i] = r < -1 ? -1 : r > 1 ? 1 : r;
      }
    }

    return true;
  }
}

registerProcessor("mixer-processor", MixerProcessor);
