/**
 * 手機遙控同步（headless）— 筆電播放分頁這端。
 *
 * 角色：筆電分頁是「唯一播放權威」。這個元件：
 *   1. 把目前狀態（now playing / 歌單 / 導唱值 / 暫停 / demucs 狀態）POST 給 backend，
 *      手機那頁就能看到。只在 JSON 真的變了才送（避免每 render 都 POST）。
 *   2. 每 1.2s GET 一次手機送來的指令，逐一交給 onCommand 套用。
 *
 * 手機那端是 server/remote.html（純靜態頁），同網域開 http://<筆電IP>:5174/remote。
 */
import { useEffect, useMemo, useRef } from "react";

export interface RemoteCommand {
  id: number;
  type:
    | "enqueue" | "insertNext" | "skip" | "removeAt"
    | "moveUp" | "moveDown" | "guide" | "playpause" | "playNow"
    | "stageOn" | "stageOff" | "stageToggle" | "seekRelative"
    | "lyricsToggle" | "restart" | "loadSnapshot" | "sidebarToggle"
    | "enqueueBatch";
  item?: { videoId: string; title: string; thumbnail?: string | null };
  items?: Array<{ videoId: string; title: string; thumbnail?: string | null }>;
  index?: number;
  value?: number;
  videoId?: string;
  seconds?: number;       // seekRelative：往前(+)或往後(-) N 秒
  snapshotId?: string;    // loadSnapshot：對應 snapshot id
  mode?: "append" | "replace";   // loadSnapshot：追加 / 替換
}

interface NowPlaying {
  videoId: string;
  title: string;
  thumbnail?: string | null;
}

export interface SnapshotSummary {
  id: string;
  name: string;
  itemCount: number;
  savedTs: number;
}

export interface UpcomingItem {
  videoId: string;
  title: string;
  thumbnail?: string | null;
  prefetchStatus?: "idle" | "processing" | "ready" | "failed";
}

interface Props {
  nowPlaying: NowPlaying | null;
  queue: { videoId: string; title: string; thumbnail?: string | null }[];
  guideVocalPercent: number;
  paused: boolean;
  hqState: string;
  hqProgress: {
    percent?: number; etaSec?: number; modelN?: number; totalModels?: number; message?: string;
  } | null;
  stageMode: boolean;
  lyricsVisible: boolean;
  snapshots: SnapshotSummary[];
  upcoming: UpcomingItem[];
  onCommand: (cmd: RemoteCommand) => void;
}

export function RemoteSync({
  nowPlaying, queue, guideVocalPercent, paused, hqState, hqProgress, stageMode, lyricsVisible,
  snapshots, upcoming, onCommand,
}: Props) {
  // 只挑會顯示的欄位，避免 thumbnail 以外的雜訊造成多餘 POST
  const payload = useMemo(
    () => ({
      nowPlaying: nowPlaying
        ? { videoId: nowPlaying.videoId, title: nowPlaying.title, thumbnail: nowPlaying.thumbnail ?? null }
        : null,
      queue: queue.map((q) => ({ videoId: q.videoId, title: q.title, thumbnail: q.thumbnail ?? null })),
      guideVocalPercent,
      paused,
      hqState,
      hqProgress: hqProgress
        ? {
            percent: hqProgress.percent ?? 0,
            etaSec: hqProgress.etaSec,
            modelN: hqProgress.modelN,
            totalModels: hqProgress.totalModels,
            message: hqProgress.message,
          }
        : null,
      stageMode,
      lyricsVisible,
      snapshots: snapshots.slice(0, 30),
      upcoming: upcoming.slice(0, 10),
    }),
    [nowPlaying, queue, guideVocalPercent, paused, hqState, hqProgress, stageMode, lyricsVisible, snapshots, upcoming],
  );

  // 推送狀態（JSON 變了才送）
  const lastSentRef = useRef("");
  useEffect(() => {
    const json = JSON.stringify(payload);
    if (json === lastSentRef.current) return;
    lastSentRef.current = json;
    fetch("/api/remote/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    }).catch(() => { /* 離線/重啟中，下次再送 */ });
  }, [payload]);

  // 輪詢手機指令（用 ref 拿最新 onCommand，interval 不重建）
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/remote/commands");
        if (!r.ok) return;
        const { commands } = await r.json();
        if (alive && Array.isArray(commands)) {
          for (const c of commands) onCommandRef.current(c as RemoteCommand);
        }
      } catch { /* ignore */ }
    };
    const h = setInterval(poll, 1200);
    poll();
    return () => { alive = false; clearInterval(h); };
  }, []);

  return null;
}
