/**
 * 與 local Node backend 對話的 client。
 *
 * 後端跑在 5174 port；vite dev server 已設 proxy /api → 5174，
 * 所以前端不論 dev 還是 prod 都呼叫相對路徑 `/api/...`。
 */

import { parseByExtension, parseLrc, parseSrt, parseVtt } from "../lyrics/parser";
import { fetchLrclib } from "../lyrics/lrclib";
import type { Lyrics } from "../lyrics/types";

export interface ResolvedYouTube {
  videoId: string;
  title: string;
  artist: string | null;
  durationSec: number;
  thumbnail: string | null;
  audioStream: { mime: string; ext: string; abr?: number } | null;
  captions: { lang: string; label: string; source: "manual" | "auto" }[];
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnail: string | null;
  /** 是否有官方/人工上傳的字幕（最準確，逐字 timing 通常較好） */
  hasManualCaptions?: boolean;
  /** 是否有 YouTube 自動生成的字幕（同語言 ASR；翻譯版很爛但會在/captions 端被避開） */
  hasAutoCaptions?: boolean;
  /** yt-dlp 偵測的原文語言（en/ja/zh…），UI 顯示用 */
  detectedLang?: string | null;
}

/** YouTube 搜尋（後端用 yt-dlp ytsearchN:keyword，不用 API key） */
export async function searchYouTube(query: string, limit = 12): Promise<YouTubeSearchResult[]> {
  const r = await fetch(
    `/api/youtube/search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `search failed: ${r.status}`);
  }
  const data = await r.json();
  return data.results as YouTubeSearchResult[];
}

/**
 * ★ 階段 1 API ★：一次拿到 audio + metadata + captions + 後續 URL。
 * 前端把 audioUrl 直接設給 <audio>，**10 秒內**就能聽歌。
 */
export interface CaptionTrack {
  lang: string;
  source: "manual" | "auto";
  label: string;
}

export interface QuickYouTube {
  videoId: string;
  title: string;
  artist: string | null;
  durationSec: number;
  thumbnail: string | null;
  audioUrl: string;            // → <audio src=…>
  videoUrl: string;            // 階段 2：背景拉 video-only mp4
  captionsUrl: string | null;  // 字幕（沒有就 null，前端 fallback lrclib）
  captionsLang?: string | null;     // backend 自動挑中的 lang（給 UI 標記「目前選中」）
  captionTracks?: CaptionTrack[];   // 全部可選 tracks（給「🔁 重挑字幕」下拉用）
  instrumentalUrl: string;     // 階段 3：demucs 伴奏（no_vocals）
  vocalsUrl?: string;          // 階段 3b：demucs 人聲（vocals，導唱混音用）
}

/** demucs 伴奏軌（no_vocals）URL。 */
export function youtubeInstrumentalUrl(videoId: string, model: string = "htdemucs"): string {
  return `/api/youtube/instrumental?id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`;
}

// ---- Spotify 匯入 ----------------------------------------------------------

export interface SpotifyTrack {
  title: string;
  artists: string[];
  durationSec: number;
}

export interface SpotifyMatchResult {
  spotifyTitle: string;
  spotifyArtists?: string[];
  videoId: string | null;
  title?: string;
  thumbnail?: string | null;
  channel?: string;
  hasCaptions?: boolean;
  error?: string;
}

export async function fetchSpotifyPlaylist(url: string): Promise<{ playlistId: string; count: number; tracks: SpotifyTrack[] }> {
  const r = await fetch(`/api/spotify/playlist?url=${encodeURIComponent(url)}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `spotify/playlist failed: ${r.status}`);
  }
  return r.json();
}

export async function matchSpotifyToYoutube(tracks: SpotifyTrack[]): Promise<{ results: SpotifyMatchResult[] }> {
  const r = await fetch(`/api/spotify/match-yt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tracks }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `spotify/match-yt failed: ${r.status}`);
  }
  return r.json();
}

/** demucs 人聲軌（vocals）URL — 導唱混音用。與 instrumental 共用同一個 demucs job。 */
export function youtubeVocalsUrl(videoId: string, model: string = "htdemucs"): string {
  return `/api/youtube/vocals?id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`;
}

export async function fetchQuick(urlOrId: string): Promise<QuickYouTube> {
  const r = await fetch(`/api/youtube/quick?url=${encodeURIComponent(urlOrId)}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `quick failed: ${r.status}`);
  }
  return r.json();
}

export async function resolveYouTube(url: string): Promise<ResolvedYouTube> {
  const r = await fetch(`/api/youtube/resolve?url=${encodeURIComponent(url)}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error || `resolve failed: ${r.status}`);
  }
  return r.json();
}

/**
 * 透過後端代理拉音訊（避免 CORS、能丟給 Web Audio）。
 * 預設 m4a（相容性最好；webm/opus 在 Safari 不解碼）。
 */
export function youtubeStreamUrl(videoId: string, fmt: "m4a" | "webm" = "m4a"): string {
  return `/api/youtube/stream?id=${encodeURIComponent(videoId)}&fmt=${fmt}`;
}

/**
 * 取得 muxed mp4（video+audio）。前端用單一 <video> 元素載入 → 畫面 + 聲音
 * 共用 timeline，完美同步。
 *
 * @param noVocals 高品質模式：backend 用 demucs 分離後 mux 回 video，音軌變成無人聲版。
 *                 首次需 1-3 分鐘處理。
 */
export function youtubeVideoUrl(
  videoId: string,
  noVocals: boolean = false,
  model: string = "htdemucs",
): string {
  const params = new URLSearchParams({ id: videoId });
  if (noVocals) {
    params.set("novocals", "1");
    params.set("model", model);
  }
  return `/api/youtube/video?${params.toString()}`;
}

export interface DemucsProgress {
  stage: "idle" | "audio_download" | "demucs" | "ffmpeg_mux" | "done" | "error";
  percent?: number;
  modelN?: number;
  totalModels?: number;
  elapsedSec?: number;
  etaSec?: number;
  message?: string;
  error?: string;
}

/**
 * Polling 進度 — 前端在 demucs 跑期間每秒呼叫。
 */
export async function fetchDemucsProgress(
  videoId: string,
  model: string,
): Promise<DemucsProgress> {
  try {
    const r = await fetch(
      `/api/youtube/progress?id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`,
    );
    if (!r.ok) return { stage: "idle" };
    return r.json();
  } catch {
    return { stage: "idle" };
  }
}

/**
 * 取得 demucs ML 分離後的 no_vocals 軌（高品質去人聲模式）。
 * 首次抽取會等 1-3 分鐘（CPU），完成後 cache 永久。
 */
export function youtubeSeparatedUrl(videoId: string): string {
  return `/api/youtube/separate?id=${encodeURIComponent(videoId)}`;
}

/**
 * 拉字幕：先試指定 lang，失敗則用 lrclib 備援。
 */
export async function fetchCaptions(
  resolved: ResolvedYouTube,
  preferredLang: string = "zh-TW"
): Promise<Lyrics> {
  const tryLangs = [preferredLang, "zh-Hant", "zh", "en"];
  for (const lang of tryLangs) {
    const hit = resolved.captions.find((c) => c.lang === lang);
    if (!hit) continue;
    try {
      const r = await fetch(
        `/api/youtube/captions?id=${resolved.videoId}&lang=${encodeURIComponent(lang)}`
      );
      if (!r.ok) continue;
      const text = await r.text();
      if (lang.startsWith("zh") || lang.startsWith("en")) {
        // 大多回 vtt
        return parseVtt(text);
      }
      return parseByExtension("." + (text.startsWith("WEBVTT") ? "vtt" : "srt"), text);
    } catch {
      /* try next */
    }
  }
  // 後備：lrclib 用 title + artist 線上找
  return fetchLrclib({
    title: resolved.title,
    artist: resolved.artist ?? null,
    durationSec: resolved.durationSec,
  });
}
