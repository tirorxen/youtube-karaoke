/**
 * 最近播放清單（localStorage 持久化）。
 * 對應 Android 端「Browse 主畫面 → 最近播放」row。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface RecentItem {
  videoId: string;
  title: string;
  thumbnail?: string | null;
  ts: number;      // 最後播放時間（unix ms）
}

interface RecentState {
  items: RecentItem[];
  add: (item: Omit<RecentItem, "ts">) => void;
  remove: (videoId: string) => void;
  clear: () => void;
}

const MAX = 10;

export const useRecent = create<RecentState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) =>
        set((state) => {
          const filtered = state.items.filter((x) => x.videoId !== item.videoId);
          const next = [{ ...item, ts: Date.now() }, ...filtered].slice(0, MAX);
          return { items: next };
        }),
      remove: (videoId) =>
        set((state) => ({
          items: state.items.filter((x) => x.videoId !== videoId),
        })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "karaoke-recent-v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
