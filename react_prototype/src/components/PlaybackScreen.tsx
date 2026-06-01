/**
 * 主畫面 — Hotfix #5：UI 重設計 + 自動 demucs + crossfade 無縫切換。
 *
 * 三大改動：
 *  1. 兩個 audio element（A=三頻段普通版、B=demucs instrumental）
 *  2. 載入新歌 ★自動★ 觸發 demucs（背景），完成後 crossfade 自動切換
 *  3. UI 大按鈕 chip（GuideVocalChips）取代滑桿，KTV 機台風
 *
 * 使用者唱歌時離電腦遠，不需要再跑去點任何按鈕。
 */
import {
  Box, Button, CircularProgress, IconButton, Sheet, Stack, Typography,
} from "@mui/joy";
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";

import { audioEngine } from "../audio/AudioEngine";
import { CaptionPicker } from "./CaptionPicker";
import { ClipboardDetector } from "./ClipboardDetector";
import { GuideVocalChips } from "./GuideVocalChips";
import { LyricsCanvas } from "./LyricsCanvas";
import { MicMeter } from "./MicMeter";
import { QueuePanel } from "./QueuePanel";
import { QueuePrefetcher } from "./QueuePrefetcher";
import { RandomRecommend } from "./RandomRecommend";
import { RecentList } from "./RecentList";
import { RemoteInfoDialog } from "./RemoteInfoDialog";
import { RemoteSync, type RemoteCommand } from "./RemoteSync";
import { SearchPanel, type EnqueueItem } from "./SearchPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SpotifyImport } from "./SpotifyImport";
import { StatusBar, type HqState } from "./StatusBar";
import { Toolbar } from "./Toolbar";
import { UrlInputDialog } from "./UrlInputDialog";
import { useQueue } from "../queue/store";
import { useQueueHistory } from "../queue/history";
import {
  fetchDemucsProgress,
  fetchQuick,
  youtubeInstrumentalUrl,
  youtubeVocalsUrl,
  type CaptionTrack,
  type DemucsProgress,
} from "../youtube/backendClient";
import { parseYouTubeId } from "../youtube/parseId";
import { fetchLrclib } from "../lyrics/lrclib";
import { parseByExtension, parseVtt } from "../lyrics/parser";
import type { Lyrics } from "../lyrics/types";
import { useRecent } from "../recent/store";
import { usePlayedHistory } from "../played/store";
import { useSettings } from "../settings/store";
import { guideVocalLevel } from "../settings/KaraokeSettings";

const NONE_LYRICS: Lyrics = { source: "NONE", lines: [] };

export function PlaybackScreen() {
  const { settings, update } = useSettings();
  const { add: addRecent } = useRecent();
  const recordPlayed = usePlayedHistory((s) => s.recordPlay);
  const queueItems = useQueue((s) => s.items);
  const queuePrefetch = useQueue((s) => s.prefetch);
  const enqueue = useQueue((s) => s.enqueue);
  const shiftQueue = useQueue((s) => s.shift);
  const insertNext = useQueue((s) => s.insertNext);
  const queueClear = useQueue((s) => s.clear);
  const historySnapshots = useQueueHistory((s) => s.snapshots);
  const [queueOpen, setQueueOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [paused, setPaused] = useState(true);
  /** 舞台視窗是否顯示字幕區。手機按「📜 字幕」可切換（亂碼歌詞時很有用）。 */
  const [lyricsVisible, setLyricsVisible] = useState(true);
  /**
   * 舞台模式：隱藏所有 chrome（toolbar/控制列/設定/狀態列），讓影片+字幕填滿整個視窗。
   * 給筆電 HDMI 接電視時，從手機一鍵切到「KTV 大螢幕」用。
   * 真・瀏覽器 fullscreen 需要 user gesture（網路指令觸發通常會被擋），所以走 CSS-fullscreen
   * 為主，requestFullscreen 只是 best-effort（若使用者剛點過頁面會生效）。
   */
  const [stageMode, setStageMode] = useState(false);
  const audioARef = useRef<HTMLAudioElement | null>(null);   // Track-A：原曲（三頻段即時版，主時鐘）
  const audioBRef = useRef<HTMLAudioElement | null>(null);   // Track-B：demucs 伴奏（no_vocals）
  const audioCRef = useRef<HTMLAudioElement | null>(null);   // Track-C：demucs 人聲（vocals，導唱混音）
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  /**
   * 目前這首歌的 videoId（本地檔=null）。用來擋「上一首的 demucs 跑很久、
   * 跑完才回到前端」時，stale 的 callback 把舊歌伴奏強切到目前這首歌身上。
   * triggerHighQualityAuto 每個 await 後都比對它，不符就放棄套用。
   */
  const currentVideoIdRef = useRef<string | null>(null);

  const [micActive, setMicActive] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics>(NONE_LYRICS);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [currentCaptionLang, setCurrentCaptionLang] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [visualState, setVisualState] = useState<"none" | "loading" | "ready" | "failed">("none");

  // 高品質狀態（自動觸發）
  const [hqState, setHqState] = useState<HqState>("off");
  const [hqProgress, setHqProgress] = useState<DemucsProgress | null>(null);

  /** 主時鐘：以當前 primary audio.currentTime 為準 */
  const getPositionMs = useMemo(
    () => () => {
      const a = audioEngine.getPrimaryMedia() ?? audioARef.current;
      const t = a?.currentTime ?? 0;
      return Math.round(t * 1000) + settings.subtitleOffsetMs;
    },
    [settings.subtitleOffsetMs]
  );

  // engine init
  useEffect(() => {
    audioEngine.init().catch((e) => console.error("AudioEngine init failed", e));
  }, []);

  // 套用 settings → engine
  useEffect(() => {
    audioEngine.applySettings(settings);
  }, [settings]);

  // 高品質進度 polling（hqState === "pending" 期間）
  useEffect(() => {
    if (hqState !== "pending" || !videoId) {
      setHqProgress(null);
      return;
    }
    const poll = setInterval(async () => {
      const p = await fetchDemucsProgress(videoId, settings.demucsModel);
      setHqProgress(p);
    }, 800);
    return () => clearInterval(poll);
  }, [hqState, videoId, settings.demucsModel]);

  // video <-> audio 同步（event-driven，不用 drift interval）
  const syncSuspendedUntilRef = useRef(0);
  useEffect(() => {
    if (visualState !== "ready") return;
    const audio = audioARef.current;
    const video = videoElRef.current;
    if (!audio || !video) return;

    const isSyncSuspended = () => Date.now() < syncSuspendedUntilRef.current;
    const onPlay = () => { if (!isSyncSuspended()) video.play().catch(() => {}); };
    const onPause = () => { if (!isSyncSuspended()) video.pause(); };
    const onSeek = () => { if (!isSyncSuspended()) video.currentTime = audio.currentTime; };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeek);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeek);
    };
  }, [visualState]);

  /**
   * audioA ↔ audioB（伴奏）+ audioC（人聲）三軌同步（#7A 擴充自 Hotfix #6）。
   *
   * demucs 雙軌模式下 audioA 靜音但仍是主時鐘＋UI controls；audioB/C 才出聲。
   * 必須讓 A 的 play/pause/seek 同步到 B、C，使用者操作才不會失效。
   * 另加 1 秒 drift 校正：B、C 必須跟 A（與彼此）保持 <80ms，否則人聲跟伴奏
   * 會聽到 echo/相位問題（HTML <audio> 不保證 sample-lock）。
   *
   * 用 syncingABRef flag 防 cascade。
   */
  const syncingABRef = useRef(false);
  useEffect(() => {
    const audioA = audioARef.current;
    if (!audioA) return;
    // 只同步「已掛 src」的 follower（vocals 軌可能 404 不存在）
    const followers = () =>
      [audioBRef.current, audioCRef.current].filter(
        (el): el is HTMLAudioElement => !!el && !!el.src,
      );

    const onPlay = () => {
      if (syncingABRef.current) return;
      if (hqState !== "ready" && hqState !== "pending") return;
      syncingABRef.current = true;
      Promise.all(followers().map((el) => el.play().catch(() => {})))
        .finally(() => { syncingABRef.current = false; });
    };
    const onPause = () => {
      if (syncingABRef.current) return;
      syncingABRef.current = true;
      followers().forEach((el) => el.pause());
      syncingABRef.current = false;
    };
    const onSeek = () => {
      if (syncingABRef.current) return;
      syncingABRef.current = true;
      followers().forEach((el) => { el.currentTime = audioA.currentTime; });
      syncingABRef.current = false;
    };

    audioA.addEventListener("play", onPlay);
    audioA.addEventListener("pause", onPause);
    audioA.addEventListener("seeked", onSeek);

    // drift 校正：每秒把 follower 對回主時鐘
    const drift = setInterval(() => {
      if (audioA.paused) return;
      for (const el of followers()) {
        if (el.paused) { el.play().catch(() => {}); continue; }
        if (Math.abs(el.currentTime - audioA.currentTime) > 0.08) {
          el.currentTime = audioA.currentTime;
        }
      }
    }, 1000);

    return () => {
      audioA.removeEventListener("play", onPlay);
      audioA.removeEventListener("pause", onPause);
      audioA.removeEventListener("seeked", onSeek);
      clearInterval(drift);
    };
  }, [hqState]);

  // ===== 載入流程 =====

  const onOpenLocal = useCallback(async (file: File, sidecar: File | null) => {
    if (!audioARef.current) return;
    await audioEngine.init();
    await audioEngine.resumeIfNeeded();

    audioEngine.resetActiveTrack();
    for (const el of [audioBRef.current, audioCRef.current]) {
      if (el) { try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* ignore */ } }
    }

    if (blobUrl) URL.revokeObjectURL(blobUrl);
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    currentVideoIdRef.current = null;   // 切到本地檔 → 讓任何進行中的 YT demucs callback 變 stale
    setVideoId(null);
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    setThumbnail(null);
    setVisualState("none");
    setHqState("off");

    audioARef.current.removeAttribute("crossorigin");
    audioARef.current.src = url;
    audioARef.current.load();
    audioEngine.attachPrimary(audioARef.current);
    audioEngine.reset();
    audioEngine.applySettings(settings);
    audioARef.current.play().catch((e) => console.warn("autoplay blocked", e));

    if (sidecar) {
      const text = await sidecar.text();
      setLyrics(parseByExtension(sidecar.name, text));
    } else {
      try {
        const guess = file.name.replace(/\.[^.]+$/, "");
        const dur = Math.round(audioARef.current.duration || 0);
        setLyrics(await fetchLrclib({ title: guess, durationSec: dur }));
      } catch { setLyrics(NONE_LYRICS); }
    }
  }, [blobUrl, settings]);

  /**
   * 自動觸發 demucs 雙軌導唱（#7A）：backend 跑 demucs，同時產生
   * 伴奏(no_vocals) + 人聲(vocals) 兩軌。完成後：
   *   - audioB.src = 伴奏 → Track-B（gain=1）
   *   - audioC.src = 人聲 → Track-C（gain=導唱值）
   *   - crossfadeToDemucs() 平滑從三頻段原曲切到雙軌
   * 之後導唱值直接控制人聲軌音量 = 真・KTV 導唱（跳回伴唱有人聲）。
   */
  const triggerHighQualityAuto = useCallback(async (id: string) => {
    const audioA = audioARef.current;
    const audioB = audioBRef.current;
    const audioC = audioCRef.current;
    if (!audioA || !audioB) return;
    if (!settings.autoTriggerHighQuality) {
      console.log("[hq] auto disabled in settings, skip");
      return;
    }
    setHqState("pending");
    console.log("[hq] auto trigger for", id, "model=", settings.demucsModel);

    const instUrl = youtubeInstrumentalUrl(id, settings.demucsModel);
    const voxUrl = youtubeVocalsUrl(id, settings.demucsModel);

    // 把一個 audio element 載到指定 url，回傳是否成功（canplaythrough）
    const loadTrack = (el: HTMLAudioElement, url: string) =>
      new Promise<boolean>((resolve) => {
        const ok = () => { cleanup(); resolve(true); };
        const fail = () => { cleanup(); resolve(false); };
        const cleanup = () => {
          el.removeEventListener("canplaythrough", ok);
          el.removeEventListener("error", fail);
        };
        el.addEventListener("canplaythrough", ok, { once: true });
        el.addEventListener("error", fail, { once: true });
        el.removeAttribute("crossorigin");
        el.src = url;
        el.load();
      });

    try {
      // HEAD instrumental：等到 200 表示 demucs 已完成（兩軌都在 disk）
      const r = await fetch(instUrl, { method: "HEAD" });
      if (!r.ok) {
        const body = await fetch(instUrl).then((rr) => rr.json()).catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }

      // ★ 防 stale #1：HEAD 期間（demucs 可能跑好幾分鐘）使用者可能已切到別首歌。
      //   此時直接放棄——連 audio element 都不要碰，避免覆蓋目前這首的 audioB/C。
      if (currentVideoIdRef.current !== id) {
        console.log("[hq] 已切歌，放棄套用過期 demucs 結果（HEAD 後）：", id);
        return;
      }

      // 平行載入兩軌（gain=0/0，不出聲）
      const [instOk, voxOk] = await Promise.all([
        loadTrack(audioB, instUrl),
        audioC ? loadTrack(audioC, voxUrl) : Promise.resolve(false),
      ]);
      if (!instOk) throw new Error("伴奏軌載入失敗");
      if (!voxOk) console.warn("[hq] vocals 軌載入失敗（將只有純伴奏，無導唱人聲）");

      // ★ 防 stale #2：載軌等待期間也可能切歌
      if (currentVideoIdRef.current !== id) {
        console.log("[hq] 已切歌，放棄 crossfade（載軌後）：", id);
        return;
      }

      // 對齊主時鐘 + 接到 graph
      audioB.currentTime = audioA.currentTime;
      audioEngine.attachSecondary(audioB);
      if (voxOk && audioC) {
        audioC.currentTime = audioA.currentTime;
        audioEngine.attachVocals(audioC);
      }

      // ★ #12B：只有 audioA 在播時才主動 play audioB/C；audioA 暫停就保持暫停。
      //   之前 unconditional play 害「YT 暫停時 demucs 跑完反而開始放去人聲版」。
      //   暫停情況下 crossfade gain 還是要切（用戶恢復播放時 sync 會自動接上）。
      const wasPlaying = !audioA.paused;
      if (wasPlaying) {
        // 不要 catch silent fail —— 若 audioA 在播但 audioB.play() 被 autoplay block，
        // 表示這個 tab 沒 user activation；不要 crossfade（會導致全靜音），讓使用者
        // 點一下 dashboard 後 drift correction 自動補播。
        try {
          await audioB.play();
          if (voxOk && audioC) await audioC.play();
        } catch (e) {
          console.warn("[hq] audioB/C play() 被擋（多半因為主畫面 tab 失去焦點）；先不 crossfade，等使用者點一下主畫面再試。", e);
          setHqState("failed");
          return;
        }
      }

      // ★ #12B：不要用 requestAnimationFrame —— 主畫面 tab 在背景時 Chrome 會把
      //   rAF 直接凍結（這就是「舞台視窗開著、demucs 完成、結果接不上」的根因）。
      //   crossfade 直接同步呼叫即可（gain 不需要等 frame）。
      if (currentVideoIdRef.current !== id) {
        console.log("[hq] 已切歌，取消 crossfade：", id);
        return;
      }
      audioEngine.crossfadeToDemucs(guideVocalLevel(settings), 250);
      console.log(`[hq] crossfade → demucs 雙軌（伴奏+人聲）, guide=${settings.guideVocalPercent}%, wasPlaying=${wasPlaying}`);
      setHqState("ready");
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[hq] auto failed:", msg);
      setHqState("failed");
    }
  }, [settings.autoTriggerHighQuality, settings.demucsModel, settings]);

  /** ★ 載入 YouTube：階段 1 拿 audio + 自動觸發階段 3 ★ */
  const loadYouTubeById = useCallback(async (id: string, originalUrl?: string) => {
    if (!audioARef.current) return;
    // ★ 同步標記目前歌（在任何 await 前）：上一首 demucs 還在跑時切歌，
    //   上一首的 triggerHighQualityAuto 等 HEAD 回來會發現 ref 已換 → 放棄套用。
    currentVideoIdRef.current = id;
    await audioEngine.init();
    await audioEngine.resumeIfNeeded();

    // 重設：把 gain 拉回 Track-A 為主、清掉 audioB/C src（避免上首歌的 demucs 結果殘留）
    audioEngine.resetActiveTrack();
    for (const el of [audioBRef.current, audioCRef.current]) {
      if (el) {
        try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* ignore */ }
      }
    }

    setVisualState("none");
    setHqState("off");
    setHqProgress(null);
    setVideoId(null);
    setTitle(null);
    setThumbnail(null);
    setLyrics(NONE_LYRICS);
    setCaptionTracks([]);
    setCurrentCaptionLang(null);
    setLoading("取得音訊（5-15 秒）…");

    try {
      const quick = await fetchQuick(originalUrl ?? id);
      setVideoId(quick.videoId);
      setTitle(quick.title);
      setThumbnail(quick.thumbnail);

      // primary audio 接到 stream URL
      if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
      audioARef.current.removeAttribute("crossorigin");
      audioARef.current.src = quick.audioUrl;
      audioARef.current.load();
      audioEngine.attachPrimary(audioARef.current);
      audioEngine.reset();
      audioEngine.applySettings(settings);

      audioARef.current.oncanplay = () => {
        setLoading(null);
        audioARef.current?.play().catch(() => {});
      };

      // 字幕（不阻塞）+ 記下可選 tracks 給 🔁 重挑用
      setCaptionTracks(quick.captionTracks ?? []);
      setCurrentCaptionLang(quick.captionsLang ?? null);
      if (quick.captionsUrl) {
        fetch(quick.captionsUrl).then(r => r.text()).then(t => setLyrics(parseVtt(t))).catch(() => {
          fetchLrclib({ title: quick.title, artist: quick.artist, durationSec: quick.durationSec })
            .then(setLyrics).catch(() => setLyrics(NONE_LYRICS));
        });
      } else {
        fetchLrclib({ title: quick.title, artist: quick.artist, durationSec: quick.durationSec })
          .then(setLyrics).catch(() => setLyrics(NONE_LYRICS));
      }

      addRecent({ videoId: quick.videoId, title: quick.title, thumbnail: quick.thumbnail });
      // 自動進已唱歌單（cap 500、永久 localStorage、playCount 累計）
      recordPlayed({ videoId: quick.videoId, title: quick.title, thumbnail: quick.thumbnail, durationSec: quick.durationSec });

      // 階段 2 背景拉視訊
      setVisualState("loading");
      if (videoElRef.current) {
        videoElRef.current.muted = true;
        videoElRef.current.src = quick.videoUrl;
        videoElRef.current.load();
        videoElRef.current.oncanplay = () => {
          setVisualState("ready");
          if (audioARef.current && videoElRef.current) {
            videoElRef.current.currentTime = audioARef.current.currentTime;
            if (!audioARef.current.paused) videoElRef.current.play().catch(() => {});
          }
        };
        videoElRef.current.onerror = () => setVisualState("failed");
      }

      // ★ 階段 3 自動觸發（背景跑 demucs）
      triggerHighQualityAuto(quick.videoId).catch(console.error);

    } catch (e) {
      console.error("[loadYouTube] failed:", e);
      window.alert("音訊載入失敗：" + (e as Error).message);
      setLoading(null);
    }
  }, [addRecent, blobUrl, settings, triggerHighQualityAuto]);

  const onOpenYouTubeUrl = useCallback((url: string) => {
    const id = parseYouTubeId(url);
    if (!id) { window.alert("無法解析 YouTube URL"); return; }
    loadYouTubeById(id, url);
  }, [loadYouTubeById]);

  // 麥克風
  const onToggleMic = useCallback(async () => {
    await audioEngine.init();
    await audioEngine.resumeIfNeeded();
    if (micActive) {
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      audioEngine.detachMic();
      micStreamRef.current = null;
      setMicActive(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      audioEngine.attachMicStream(stream);
      micStreamRef.current = stream;
      setMicActive(true);
    } catch (e) {
      window.alert("無法取得麥克風：" + (e as Error).message);
    }
  }, [micActive]);

  // 拖放
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url) {
      const id = parseYouTubeId(url);
      if (id) { loadYouTubeById(id, url); return; }
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      const media = files.find(f => /\.(mp3|wav|flac|ogg|mp4|webm|mkv)$/i.test(f.name));
      const sidecar = files.find(f => /\.(lrc|srt|vtt)$/i.test(f.name)) ?? null;
      if (media) onOpenLocal(media, sidecar);
    }
  }, [loadYouTubeById, onOpenLocal]);

  // 切導唱值（chip 觸發）
  const onChangeGuide = useCallback((v: number) => {
    update({ guideVocalPercent: v });
  }, [update]);

  // 重挑字幕：使用者按 🔁 字幕 → 改抓指定 lang
  const pickCaption = useCallback(async (track: CaptionTrack) => {
    if (!videoId) return;
    setCurrentCaptionLang(track.lang);
    try {
      const r = await fetch(`/api/youtube/captions?id=${videoId}&lang=${encodeURIComponent(track.lang)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      setLyrics(parseVtt(t));
    } catch (e) {
      console.error("[caption] pick failed:", e);
    }
  }, [videoId]);

  // 🎵 #18A：從歌詞庫（lrclib.net）強制重抓 — MV CC 對不準時最後一招
  const forceLrclib = useCallback(async () => {
    if (!title) return;
    try {
      const lrc = await fetchLrclib({
        title,
        artist: null,   // lrclib 不一定要 artist，用標題就行
        durationSec: Math.round(audioARef.current?.duration ?? 0),
      });
      if (lrc.lines.length > 0) {
        setLyrics(lrc);
        setCurrentCaptionLang(null);   // 已不是 YT CC track
      } else {
        window.alert("歌詞庫沒這首歌的同步歌詞（lrclib.net 上沒收錄）。");
      }
    } catch (e) {
      console.error("[lrclib] failed:", e);
      window.alert("從歌詞庫抓失敗：" + (e as Error).message);
    }
  }, [title]);

  // 歌單：加入隊尾
  const onEnqueue = useCallback((item: EnqueueItem) => {
    enqueue(item);
  }, [enqueue]);

  // 切下一首（手動切歌 / 一首唱完自動）：取出隊首載入
  const playNext = useCallback(() => {
    const next = shiftQueue();
    if (next) {
      console.log("[queue] play next:", next.videoId, next.title);
      loadYouTubeById(next.videoId);
    }
  }, [shiftQueue, loadYouTubeById]);

  // 一首播完 → 自動接歌單下一首（像 KTV 連續播放）
  useEffect(() => {
    const audioA = audioARef.current;
    if (!audioA) return;
    const onEnded = () => playNext();
    audioA.addEventListener("ended", onEnded);
    return () => audioA.removeEventListener("ended", onEnded);
  }, [playNext]);

  // ★ #13B 強制自動儲存歌單 ★
  // 每次 queue 有變動就 debounce 5s 後寫一份 auto snapshot 進歷史。
  // 永遠覆蓋同一張卡（id=auto_latest），歷史分頁/手機過去歌單 打開就在最上面，
  // 一鍵還原。即使瀏覽器當掉、清歌單、不小心打 ↻ 替換，都能撈回上次的歌單。
  // 5s 是「夠快保命」與「不要每次操作都立刻寫 localStorage」的平衡。
  useEffect(() => {
    if (queueItems.length === 0) return;
    const t = setTimeout(() => {
      useQueueHistory.getState().autoSave(queueItems);
    }, 5000);
    return () => clearTimeout(t);
  }, [queueItems]);

  // 追蹤暫停狀態（給手機遙控顯示「播放/暫停」用）
  useEffect(() => {
    const a = audioARef.current;
    if (!a) return;
    const upd = () => setPaused(a.paused);
    a.addEventListener("play", upd);
    a.addEventListener("pause", upd);
    upd();
    return () => { a.removeEventListener("play", upd); a.removeEventListener("pause", upd); };
  }, []);

  // 目前播放中（給手機遙控顯示）
  const nowPlaying = useMemo(
    () => (videoId || title ? { videoId: videoId ?? "", title: title ?? "", thumbnail } : null),
    [videoId, title, thumbnail],
  );

  // 過去歌單摘要（手機遙控的「📚 過去歌單」用，含 auto_latest）
  const snapshotsSummary = useMemo(
    () => historySnapshots.map((s) => ({
      id: s.id,
      name: s.name,
      itemCount: s.items.length,
      savedTs: s.savedTs,
    })),
    [historySnapshots],
  );

  // 接下來歌單（前 5 首含 prefetch 狀態，給舞台側欄 + 手機看 demucs 預處理進度）
  const upcomingForRemote = useMemo(
    () => queueItems.slice(0, 5).map((it) => ({
      videoId: it.videoId,
      title: it.title,
      thumbnail: it.thumbnail ?? null,
      prefetchStatus: queuePrefetch[it.videoId] ?? "idle",
    })),
    [queueItems, queuePrefetch],
  );

  // 套用手機送來的遙控指令（筆電是唯一播放權威）
  const handleRemoteCommand = useCallback((cmd: RemoteCommand) => {
    const q = useQueue.getState();
    switch (cmd.type) {
      case "enqueue":
        if (cmd.item) enqueue(cmd.item);
        break;
      case "enqueueBatch":
        // 手機 Spotify 匯入：一次送 30 首；store 內已有去重
        if (Array.isArray(cmd.items)) {
          for (const it of cmd.items) enqueue(it);
        }
        break;
      case "insertNext":
        if (cmd.item) insertNext(cmd.item);
        break;
      case "skip":
        playNext();
        break;
      case "removeAt":
        if (typeof cmd.index === "number") q.removeAt(cmd.index);
        break;
      case "moveUp":
        if (typeof cmd.index === "number") q.moveUp(cmd.index);
        break;
      case "moveDown":
        if (typeof cmd.index === "number") q.moveDown(cmd.index);
        break;
      case "guide":
        if (typeof cmd.value === "number") update({ guideVocalPercent: cmd.value });
        break;
      case "playpause": {
        const a = audioARef.current;
        if (a) { if (a.paused) a.play().catch(() => {}); else a.pause(); }
        break;
      }
      case "playNow":
        if (cmd.videoId) {
          const idx = q.items.findIndex((x) => x.videoId === cmd.videoId);
          if (idx >= 0) q.removeAt(idx);
          loadYouTubeById(cmd.videoId);
        }
        break;
      case "stageOn":
        setStageMode(true);
        break;
      case "stageOff":
        setStageMode(false);
        break;
      case "stageToggle":
        setStageMode((m) => !m);
        break;
      case "seekRelative": {
        const a = audioARef.current;
        if (a && typeof cmd.seconds === "number") {
          const target = Math.max(0, Math.min(a.duration || 1e9, a.currentTime + cmd.seconds));
          a.currentTime = target;   // audioB/C drift correction 會自動跟上
        }
        break;
      }
      case "restart": {
        const a = audioARef.current;
        if (a) {
          a.currentTime = 0;   // 從頭開始；audioB/C drift correction 會接上
          if (a.paused) a.play().catch(() => {});
        }
        break;
      }
      case "loadSnapshot": {
        // 手機按「📚 過去歌單 → 載入」會送這個。dashboard 從歷史 store 撈完整 snapshot 套用。
        if (!cmd.snapshotId) break;
        const snap = useQueueHistory.getState().snapshots.find((s) => s.id === cmd.snapshotId);
        if (!snap) break;
        if (cmd.mode === "replace") queueClear();
        for (const it of snap.items) {
          enqueue({
            videoId: it.videoId,
            title: it.title,
            thumbnail: it.thumbnail ?? null,
            durationSec: it.durationSec,
          });
        }
        break;
      }
      case "sidebarToggle": {
        // 手機按「📋 下一首清單」→ 透過 BroadcastChannel 傳給 stage 視窗切顯示
        stageChannelRef.current?.postMessage({ type: "sidebarToggle" });
        break;
      }
      case "lyricsToggle":
        setLyricsVisible((v) => !v);
        break;
    }
  }, [enqueue, insertNext, playNext, update, loadYouTubeById]);

  // ===== 舞台模式（新視窗）=====
  // 設計：stageMode=true 時開啟 /stage.html 新視窗（YT 原生全螢幕風格）；
  //   - 與 dashboard 同源 → 走 BroadcastChannel("karaoke-stage") 同步狀態
  //   - dashboard 一直是「控制台」，stage 視窗只是顯示鏡像（影片 muted、字幕、demucs 進度）
  //   - 音訊由 dashboard 出（HDMI 接電視就走 TV 喇叭）
  //   - 防 popup blocker：必須由 user gesture 觸發（Toolbar 📺 按鈕直接呼，phone 命令可能被擋）
  const stageWindowRef = useRef<Window | null>(null);
  const stageChannelRef = useRef<BroadcastChannel | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  /**
   * ★ 修「舞台視窗開了但收不到影片/字幕」bug ★
   *
   * BroadcastChannel onmessage handler 是在 mount-only effect（[] deps）裡綁的，
   * 如果直接 closure 抓 videoId/title/lyrics 等 state，會永遠是「掛載當下的初始值」
   * （都是 null）。使用者開 stage 時這些 state 早已是當前歌的真實值，但 handler
   * 取到的仍是 null → 回 stage 一個空 songChange → stage 沒影片、沒字幕。
   *
   * 解法：用 ref 鏡像最新值，handler 每次 fire 時讀 ref 拿到的就是真實當前值。
   */
  const broadcastDataRef = useRef({
    videoId: null as string | null,
    title: null as string | null,
    lyrics: NONE_LYRICS as Lyrics,
    hqState: "off" as HqState,
    hqProgress: null as DemucsProgress | null,
    lyricsVisible: true,
    upcoming: [] as Array<{ videoId: string; title: string; thumbnail?: string | null; prefetchStatus?: string }>,
  });
  useEffect(() => {
    broadcastDataRef.current = { videoId, title, lyrics, hqState, hqProgress, lyricsVisible, upcoming: upcomingForRemote };
  }, [videoId, title, lyrics, hqState, hqProgress, lyricsVisible, upcomingForRemote]);

  // BroadcastChannel 一次建好（handler 讀 ref，避免 stale closure）
  useEffect(() => {
    const ch = new BroadcastChannel("karaoke-stage");
    stageChannelRef.current = ch;
    ch.onmessage = (e) => {
      const m = e.data;
      if (m?.type === "bye") {
        // stage 被使用者關掉 → 收回 stageMode
        setStageMode(false);
        return;
      }
      if (m?.type === "hello") {
        // stage 剛開（或重試 hello）→ 用 ref 拿最新狀態回覆
        const d = broadcastDataRef.current;
        // skip 廣播 null 過渡狀態（同 #16A）
        if (d.videoId || d.title) {
          ch.postMessage({
            type: "songChange",
            videoUrl: d.videoId ? `/api/youtube/visual?id=${d.videoId}` : null,
            title: d.title,
            lyrics: d.lyrics,
            currentMs: Math.round((audioARef.current?.currentTime ?? 0) * 1000),
          });
        }
        ch.postMessage({ type: "hq", hqState: d.hqState, hqProgress: d.hqProgress });
        ch.postMessage({ type: "lyricsVis", visible: d.lyricsVisible });
        ch.postMessage({ type: "queueInfo", upcoming: d.upcoming });
        return;
      }
    };
    return () => { ch.close(); stageChannelRef.current = null; };
  }, []);

  // ★ #13E 撤回 CSS-fullscreen，回到 window.open /stage.html ★
  //
  // CSS-fullscreen 雖然不用 user gesture，但會把 video / lyrics / 整包 layout
  // 擠在 dashboard chrome 範圍內變形 —— 使用者體感不對。
  //
  // 改回獨立視窗：stage.html 有自己乾淨的全螢幕 layout，video object-fit:contain、
  // lyrics 自動 scale 變大、HUD 浮動在角落。**唯一代價**是進入 fullscreen 那刻
  // 需要在 stage 視窗按任意鍵 / 點任意處（瀏覽器 fullscreen API 規定要 user gesture）。
  // stage.html 整層滿版 overlay「點任意處進入全螢幕」+ 多 event 監聽，1 次點擊就過。
  useEffect(() => {
    if (!stageMode) {
      const w = stageWindowRef.current;
      if (w && !w.closed) {
        try { stageChannelRef.current?.postMessage({ type: "close" }); } catch { /* ignore */ }
        try { w.close(); } catch { /* ignore */ }
      }
      stageWindowRef.current = null;
      return;
    }
    if (stageWindowRef.current && !stageWindowRef.current.closed) {
      stageWindowRef.current.focus();
      return;
    }
    const sw = window.screen?.availWidth ?? 1280;
    const sh = window.screen?.availHeight ?? 720;
    const features = `popup=yes,noopener=no,width=${sw},height=${sh},left=0,top=0`;
    const win = window.open("/stage.html", "karaoke-stage", features);
    if (!win) {
      // Popup 被擋（手機指令觸發時 dashboard 沒 user gesture → 必擋）
      console.warn("[stage] popup blocked");
      setPopupBlocked(true);
      setStageMode(false);
      return;
    }
    setPopupBlocked(false);
    stageWindowRef.current = win;
    const check = setInterval(() => {
      if (win.closed) { clearInterval(check); setStageMode(false); }
    }, 800);
    return () => clearInterval(check);
  }, [stageMode]);

  // 廣播：song change（含 lyrics）
  // ★ #16A 修舞台切歌不同步 ★
  // loadYouTubeById 開頭會 setVideoId(null) 重設，5-15s 後 fetchQuick 完才 setVideoId(B)。
  // 中間那段 null 期間若廣播 → 舞台 applySongChange 走 else 分支清掉 video.src + 顯示
  // placeholder → 看起來「卡住」。skip null videoId 期間不廣播，舞台保留前一首畫面，
  // 等到 B 真的 ready 才換。本機檔（videoId=null 但 title 有東西）仍可廣播一次 title。
  useEffect(() => {
    if (!stageMode) return;
    if (!videoId && !title) return;   // skip transition state
    const ch = stageChannelRef.current;
    if (!ch) return;
    ch.postMessage({
      type: "songChange",
      videoUrl: videoId ? `/api/youtube/visual?id=${videoId}` : null,
      title,
      lyrics,
      currentMs: Math.round((audioARef.current?.currentTime ?? 0) * 1000),
    });
  }, [stageMode, videoId, title, lyrics]);

  // 廣播：hq 狀態
  useEffect(() => {
    if (!stageMode) return;
    stageChannelRef.current?.postMessage({ type: "hq", hqState, hqProgress });
  }, [stageMode, hqState, hqProgress]);

  // 廣播：upcoming queue（給舞台右側欄看下一首 + prefetch 狀態）
  useEffect(() => {
    if (!stageMode) return;
    stageChannelRef.current?.postMessage({ type: "queueInfo", upcoming: upcomingForRemote });
  }, [stageMode, upcomingForRemote]);

  // 廣播：字幕區顯示／隱藏（手機可從遙控器切）
  useEffect(() => {
    if (!stageMode) return;
    stageChannelRef.current?.postMessage({ type: "lyricsVis", visible: lyricsVisible });
  }, [stageMode, lyricsVisible]);

  // 廣播：位置（每 500ms + play/pause/seek 即時）
  useEffect(() => {
    if (!stageMode) return;
    const a = audioARef.current;
    const push = () => {
      stageChannelRef.current?.postMessage({
        type: "position",
        currentMs: Math.round((a?.currentTime ?? 0) * 1000),
        durationMs: Math.round(((a?.duration && isFinite(a.duration) ? a.duration : 0)) * 1000),
        paused: a?.paused ?? true,
      });
    };
    push();
    const h = setInterval(push, 500);
    if (a) {
      a.addEventListener("play", push);
      a.addEventListener("pause", push);
      a.addEventListener("seeked", push);
    }
    return () => {
      clearInterval(h);
      if (a) {
        a.removeEventListener("play", push);
        a.removeEventListener("pause", push);
        a.removeEventListener("seeked", push);
      }
    };
  }, [stageMode]);

  // dashboard Esc → 關掉舞台視窗（方便鍵）
  useEffect(() => {
    if (!stageMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStageMode(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stageMode]);

  // ★ #15A 修 MV 卡頓 ★
  // stage 視窗已經在解一份 H.264，dashboard 再解一份 = 兩倍 GPU video decode
  // → 跟 demucs 搶資源 → 卡頓。stage 開啟時暫停 dashboard 影片（你也看不到，
  // 留 audioA 給 KTV 處理就好）。關閉 stage 時重新同步 audioA 繼續播。
  useEffect(() => {
    const v = videoElRef.current;
    const a = audioARef.current;
    if (!v) return;
    if (stageMode) {
      v.pause();
    } else if (visualState === "ready" && a) {
      // 回 dashboard → 把 video 對齊 audioA 時間軸再播
      try { v.currentTime = a.currentTime; } catch { /* ignore */ }
      if (!a.paused) v.play().catch(() => { /* autoplay block, no-op */ });
    }
  }, [stageMode, visualState]);

  // ===== Render =====
  return (
    <Stack
      direction="column"
      sx={{ height: "100vh", width: "100vw", position: "relative" }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Toolbar
        onOpenLocal={onOpenLocal}
        onOpenYouTubeUrl={onOpenYouTubeUrl}
        onOpenUrlDialog={() => setUrlDialogOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenQueue={() => setQueueOpen(true)}
        queueCount={queueItems.length}
        onOpenRemote={() => setRemoteOpen(true)}
        onToggleStage={() => setStageMode((m) => !m)}
        onOpenSpotify={() => setSpotifyOpen(true)}
        onToggleMic={onToggleMic}
        micActive={micActive}
      />

      <ClipboardDetector currentVideoId={videoId} onLoad={onOpenYouTubeUrl} />

      <StatusBar title={title} hqState={hqState} hqProgress={hqProgress} />

      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* 視訊區 */}
          <Box sx={{ flex: 1, background: "#000", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <video
              ref={videoElRef}
              muted
              playsInline
              style={{
                width: "100%", height: "100%", background: "#000",
                objectFit: "contain",   // 保留 aspect ratio（舞台模式變大時不變形/不裁切）
                display: visualState === "ready" ? "block" : "none",
              }}
            />

            {visualState !== "ready" && (videoId || blobUrl) && (
              <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2 }}>
                {thumbnail && <img src={thumbnail} alt="" style={{ maxWidth: "60%", maxHeight: "70%", opacity: 0.6 }} />}
                <Typography level="body-sm" sx={{ color: "rgba(255,255,255,0.7)" }}>
                  {visualState === "loading" ? "🎬 影片畫面載入中…" :
                   visualState === "failed" ? "🎵 純音訊模式" : "🎵 音訊播放中"}
                </Typography>
              </Box>
            )}

            {!videoId && !blobUrl && (
              <Stack spacing={2} sx={{ width: "100%", height: "100%", overflow: "auto", py: 3, alignItems: "center" }}>
                <SearchPanel onPick={(id) => loadYouTubeById(id)} onEnqueue={onEnqueue} />
                <RandomRecommend onPlay={(id) => loadYouTubeById(id)} onEnqueue={onEnqueue} />
                <RecentList onPlay={(id) => loadYouTubeById(id)} onEnqueue={onEnqueue} />
              </Stack>
            )}

            {loading && (
              <Sheet
                sx={{
                  position: "absolute", inset: 0, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  flexDirection: "column", gap: 2,
                  background: "rgba(0,0,0,0.85)", color: "white", zIndex: 10,
                }}
              >
                <CircularProgress />
                <Typography level="body-md" sx={{ color: "white" }}>{loading}</Typography>
              </Sheet>
            )}
          </Box>

          {/* 字幕 */}
          <LyricsCanvas lyrics={lyrics} getPositionMs={getPositionMs} />

          {/* KTV 控制區：導唱 chips + 隱藏的 audio elements + mic meter + ⚙ */}
          <Sheet sx={{ p: 1.5, borderTop: "1px solid #333" }}>
            <Stack spacing={1.5}>
              {/* 導唱值 chips */}
              <GuideVocalChips
                value={settings.guideVocalPercent}
                onChange={onChangeGuide}
              />

              {/* audioA controls + transport 控制按鈕（dashboard 本機方便鍵） */}
              <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" useFlexGap>
                <audio ref={audioARef} controls style={{ flex: 1, minWidth: 280 }} />
                {/* ⏪ -10s / ⏩ +10s / 🔄 重頭 — 跟手機遙控同步的本機操作 */}
                <Button
                  variant="outlined" size="sm" sx={{ flexShrink: 0 }}
                  title="倒退 10 秒"
                  onClick={() => {
                    const a = audioARef.current; if (!a) return;
                    a.currentTime = Math.max(0, a.currentTime - 10);
                  }}
                >⏪ -10s</Button>
                <Button
                  variant="outlined" size="sm" sx={{ flexShrink: 0 }}
                  title="快進 10 秒"
                  onClick={() => {
                    const a = audioARef.current; if (!a) return;
                    a.currentTime = Math.min(a.duration || 1e9, a.currentTime + 10);
                  }}
                >⏩ +10s</Button>
                <Button
                  variant="outlined" size="sm" sx={{ flexShrink: 0 }}
                  title="從頭播放這首"
                  onClick={() => {
                    const a = audioARef.current; if (!a) return;
                    a.currentTime = 0;
                    if (a.paused) a.play().catch(() => {});
                  }}
                >🔄 重頭</Button>
                {queueItems.length > 0 && (
                  <Button variant="solid" color="warning" size="sm" onClick={playNext} sx={{ flexShrink: 0 }}>
                    ⏭ 切下一首（{queueItems.length}）
                  </Button>
                )}
                <CaptionPicker tracks={captionTracks} currentLang={currentCaptionLang} onPick={pickCaption} onForceLrclib={forceLrclib} />
                <MicMeter stream={micStreamRef.current} ctx={audioEngine.context()} />
                <IconButton variant="outlined" onClick={() => setSettingsOpen(o => !o)}>⚙</IconButton>
              </Stack>

              {/* audioB（伴奏）、audioC（人聲）永遠 hidden — 只給 AudioEngine demucs 雙軌用 */}
              <audio ref={audioBRef} style={{ display: "none" }} />
              <audio ref={audioCRef} style={{ display: "none" }} />

              {/* 高品質失敗時提供重試 */}
              {hqState === "failed" && videoId && (
                <Button
                  variant="outlined" color="warning" size="sm"
                  onClick={() => triggerHighQualityAuto(videoId)}
                >
                  🤖 重試高品質去人聲
                </Button>
              )}
            </Stack>
          </Sheet>
        </Box>

        {/* 設定抽屜（預設收起） */}
        {settingsOpen && (
          <Box sx={{ width: 320, borderLeft: "1px solid #333", overflow: "auto" }}>
            <SettingsPanel />
          </Box>
        )}
      </Stack>

      {/* 拖放提示 */}
      {dragOver && (
        <Sheet
          color="primary" variant="solid"
          sx={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            opacity: 0.85, pointerEvents: "none", zIndex: 9999,
          }}
        >
          <Typography level="h3" sx={{ color: "white" }}>
            放開以載入 YouTube 連結或音訊檔
          </Typography>
        </Sheet>
      )}

      <UrlInputDialog
        open={urlDialogOpen}
        onClose={() => setUrlDialogOpen(false)}
        onSubmit={onOpenYouTubeUrl}
      />

      {searchOpen && (
        <Sheet
          sx={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            zIndex: 10000, display: "flex", flexDirection: "column",
            alignItems: "center", overflow: "auto", py: 4,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}
        >
          <Stack direction="row" justifyContent="space-between" sx={{ width: "100%", maxWidth: 980, px: 2, mb: 1 }}>
            <Typography level="h4" sx={{ color: "white" }}>🔍 搜尋 YouTube</Typography>
            <button
              onClick={() => setSearchOpen(false)}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "white", cursor: "pointer", fontSize: 16, padding: "4px 12px", borderRadius: 4 }}
            >
              ✕ 關閉
            </button>
          </Stack>
          <SearchPanel
            onPick={(id) => { setSearchOpen(false); loadYouTubeById(id); }}
            onEnqueue={onEnqueue}
          />
        </Sheet>
      )}

      {/* 歌單背景預處理（headless）：排隊的歌先跑 demucs */}
      <QueuePrefetcher />

      {/* 手機遙控同步（headless）：推狀態 + 收手機指令 */}
      <RemoteSync
        nowPlaying={nowPlaying}
        queue={queueItems}
        guideVocalPercent={settings.guideVocalPercent}
        paused={paused}
        hqState={hqState}
        hqProgress={hqProgress}
        stageMode={stageMode}
        lyricsVisible={lyricsVisible}
        snapshots={snapshotsSummary}
        upcoming={upcomingForRemote}
        onCommand={handleRemoteCommand}
      />

      <RemoteInfoDialog open={remoteOpen} onClose={() => setRemoteOpen(false)} />
      <SpotifyImport open={spotifyOpen} onClose={() => setSpotifyOpen(false)} />

      {/* 舞台視窗開啟提示（dashboard 角落） */}
      {stageMode && (
        <Box
          sx={{
            position: "fixed", bottom: 12, right: 12, zIndex: 9999,
            display: "flex", gap: 1.5, alignItems: "center",
            background: "rgba(0,0,0,0.7)", color: "#fff",
            px: 1.5, py: 0.75, borderRadius: 999, fontSize: 13,
          }}
        >
          <span>📺 舞台視窗已開啟 · 在那邊點任意處進入全螢幕</span>
          <IconButton
            size="sm" variant="plain"
            onClick={() => setStageMode(false)}
            sx={{ color: "#fff", "--Icon-color": "#fff", minHeight: 26, minWidth: 26 }}
            title="關閉舞台視窗（Esc）"
          >
            ✕
          </IconButton>
        </Box>
      )}

      {/* Popup 被擋（手機指令觸發時 dashboard 沒 user gesture → 必擋）→ 提示按一下 */}
      {popupBlocked && (
        <Sheet
          variant="solid" color="warning"
          sx={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
            zIndex: 9998, px: 2, py: 1.5, borderRadius: 8,
            display: "flex", gap: 2, alignItems: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <span>📺 手機要求開啟舞台視窗，但被瀏覽器擋了 — 按此確認開啟</span>
          <Button
            size="sm" variant="solid" color="primary"
            onClick={() => { setPopupBlocked(false); setStageMode(true); }}
          >
            開啟舞台
          </Button>
          <IconButton size="sm" variant="plain" onClick={() => setPopupBlocked(false)}>✕</IconButton>
        </Sheet>
      )}

      {/* 歌單面板 */}
      {queueOpen && (
        <QueuePanel
          onClose={() => setQueueOpen(false)}
          onPlayNow={(id) => loadYouTubeById(id)}
        />
      )}
    </Stack>
  );
}
