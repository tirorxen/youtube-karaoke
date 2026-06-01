/**
 * 已唱歌單（usePlayedHistory）— 過去播放過的歌自動存下來，永久（localStorage cap 500）。
 *
 * 對應使用者「我已經唱了 30 首，下次想再唱一遍」的需求。比 useRecent（10 筆）容量大、
 * 而且記錄 playCount + lastPlayedTs，可用來：
 *   - QueuePanel 「🔁 再唱一次」分頁列出全部
 *   - 空狀態頁「🎲 隨機推薦」洗牌抽 N 首
 *
 * 不在這裡管 cache 檔案（音檔/影片/demucs 結果），那個是 backend disk cache 的事。
 * 兩邊配合：歷史在 localStorage 永遠，cache 在 .media-cache 持久化 → 重點同一首歌時
 * 既能在 UI 找到、又 instant 載入。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface PlayedItem {
  videoId: string;
  title: string;
  thumbnail?: string | null;
  durationSec?: number;
  firstPlayedTs: number;
  lastPlayedTs: number;
  playCount: number;
}

interface State {
  items: PlayedItem[];
  recordPlay: (item: { videoId: string; title: string; thumbnail?: string | null; durationSec?: number }) => void;
  remove: (videoId: string) => void;
  clear: () => void;
  /** 隨機抽 N 首（用 played history 模擬「類似曲風推薦」—— 真．類似演算法太重，先用洗牌頂著） */
  pickRandom: (n: number) => PlayedItem[];
}

const MAX = 500;

export const usePlayedHistory = create<State>()(
  persist(
    (set, get) => ({
      items: [],
      recordPlay: (it) =>
        set((s) => {
          const idx = s.items.findIndex((x) => x.videoId === it.videoId);
          const now = Date.now();
          if (idx >= 0) {
            const old = s.items[idx];
            const updated: PlayedItem = {
              ...old,
              lastPlayedTs: now,
              playCount: old.playCount + 1,
              title: it.title || old.title,
              thumbnail: it.thumbnail ?? old.thumbnail,
              durationSec: it.durationSec ?? old.durationSec,
            };
            // 移到最前面（lastPlayedTs 順序）
            return { items: [updated, ...s.items.slice(0, idx), ...s.items.slice(idx + 1)] };
          }
          const fresh: PlayedItem = {
            videoId: it.videoId,
            title: it.title,
            thumbnail: it.thumbnail ?? null,
            durationSec: it.durationSec,
            firstPlayedTs: now,
            lastPlayedTs: now,
            playCount: 1,
          };
          return { items: [fresh, ...s.items].slice(0, MAX) };
        }),
      remove: (videoId) => set((s) => ({ items: s.items.filter((x) => x.videoId !== videoId) })),
      clear: () => set({ items: [] }),
      pickRandom: (n) => {
        const items = get().items.slice();
        // Fisher-Yates shuffle
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
        return items.slice(0, n);
      },
    }),
    {
      name: "karaoke-played-history-v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
