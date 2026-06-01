/**
 * 歌單 queue（待播清單）— localStorage 持久化，像真 KTV 點歌機。
 *
 * 設計：queue 只放「接下來要唱的歌」，目前正在播的歌不在 queue 裡。
 *   - enqueue：加到隊尾（一般點歌）
 *   - insertNext：插到隊首（插播）
 *   - shift：取出隊首（一首唱完 / 按「切下一首」時）
 *
 * prefetch：每首歌的 demucs 背景預處理狀態（in-memory，不持久化；
 * 因為 demucs 結果 cache 在 backend disk，重開頁面只要再 HEAD 一次就 instant）。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type QueueHqStatus = "idle" | "processing" | "ready" | "failed";

export interface QueueItem {
  videoId: string;
  title: string;
  thumbnail?: string | null;
  durationSec?: number;
  addedTs: number;
}

interface QueueState {
  items: QueueItem[];
  /** videoId → demucs 背景預處理狀態（不持久化）。 */
  prefetch: Record<string, QueueHqStatus>;

  enqueue: (item: Omit<QueueItem, "addedTs">) => void;
  insertNext: (item: Omit<QueueItem, "addedTs">) => void;
  removeAt: (index: number) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
  clear: () => void;
  /** 取出並移除隊首（切下一首）。空時回 null。 */
  shift: () => QueueItem | null;
  setPrefetch: (videoId: string, status: QueueHqStatus) => void;
}

export const useQueue = create<QueueState>()(
  persist(
    (set, get) => ({
      items: [],
      prefetch: {},

      enqueue: (item) =>
        set((s) => {
          if (s.items.some((x) => x.videoId === item.videoId)) return s;   // 去重
          return { items: [...s.items, { ...item, addedTs: Date.now() }] };
        }),

      insertNext: (item) =>
        set((s) => {
          const rest = s.items.filter((x) => x.videoId !== item.videoId);
          return { items: [{ ...item, addedTs: Date.now() }, ...rest] };
        }),

      removeAt: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),

      moveUp: (index) =>
        set((s) => {
          if (index <= 0 || index >= s.items.length) return s;
          const next = s.items.slice();
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          return { items: next };
        }),

      moveDown: (index) =>
        set((s) => {
          if (index < 0 || index >= s.items.length - 1) return s;
          const next = s.items.slice();
          [next[index + 1], next[index]] = [next[index], next[index + 1]];
          return { items: next };
        }),

      clear: () => set({ items: [] }),

      shift: () => {
        const { items } = get();
        if (items.length === 0) return null;
        const [head, ...rest] = items;
        set({ items: rest });
        return head;
      },

      setPrefetch: (videoId, status) =>
        set((s) => ({ prefetch: { ...s.prefetch, [videoId]: status } })),
    }),
    {
      name: "karaoke-queue-v1",
      storage: createJSONStorage(() => localStorage),
      // 只持久化 items；prefetch 狀態每次開頁重新算
      partialize: (s) => ({ items: s.items }),
    }
  )
);
