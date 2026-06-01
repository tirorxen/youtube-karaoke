/**
 * 歷史歌單（snapshots）—— 儲存當前歌單成命名 snapshot，之後可載入。
 * 對應 KTV 機台的「我的點唱清單」。
 *
 * 行為：localStorage 持久化、cap 20 筆（FIFO 砍最舊）。
 * 載入時前端有「追加 / 替換」兩種模式（QueuePanel 處理）。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { QueueItem } from "./store";

export interface QueueSnapshot {
  id: string;
  name: string;
  items: Array<{ videoId: string; title: string; thumbnail?: string | null; durationSec?: number }>;
  savedTs: number;
}

interface State {
  snapshots: QueueSnapshot[];
  save: (name: string, items: QueueItem[]) => string;
  /**
   * 自動儲存：每次 queue 變動 debounce 後呼叫；維護一份固定 id `auto_latest`，
   * 永遠 overwrite。瀏覽器當掉/重整/清歌單都能用「歷史」分頁第一張卡還原。
   */
  autoSave: (items: QueueItem[]) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX = 20;
const AUTO_ID = "auto_latest";

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const useQueueHistory = create<State>()(
  persist(
    (set) => ({
      snapshots: [],
      save: (name, items) => {
        const id = newId();
        const finalName = (name || "").trim() || `歌單 ${new Date().toLocaleString("zh-TW", { hour12: false })}`;
        set((s) => ({
          snapshots: [
            {
              id,
              name: finalName,
              items: items.map((it) => ({
                videoId: it.videoId,
                title: it.title,
                thumbnail: it.thumbnail ?? null,
                durationSec: it.durationSec,
              })),
              savedTs: Date.now(),
            },
            ...s.snapshots,
          ].slice(0, MAX),
        }));
        return id;
      },
      autoSave: (items) =>
        set((s) => {
          if (items.length === 0) {
            // 空歌單就不存（避免「上一次的歌單：0 首」這種廢卡）
            return s;
          }
          const others = s.snapshots.filter((x) => x.id !== AUTO_ID);
          const auto: QueueSnapshot = {
            id: AUTO_ID,
            name: `📌 上一次的歌單（${new Date().toLocaleString("zh-TW", { hour12: false })}）`,
            items: items.map((it) => ({
              videoId: it.videoId,
              title: it.title,
              thumbnail: it.thumbnail ?? null,
              durationSec: it.durationSec,
            })),
            savedTs: Date.now(),
          };
          // auto 永遠排第一，下面是 manual snapshots
          return { snapshots: [auto, ...others].slice(0, MAX) };
        }),

      rename: (id, name) =>
        set((s) => ({ snapshots: s.snapshots.map((x) => (x.id === id ? { ...x, name } : x)) })),
      remove: (id) =>
        set((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id) })),
      clear: () => set({ snapshots: [] }),
    }),
    {
      name: "karaoke-queue-history-v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
