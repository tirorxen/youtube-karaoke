/**
 * Zustand store + localStorage 持久化。對應 Android DataStore 與 Python SettingsStore。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import {
  DEFAULT_SETTINGS,
  KaraokeSettings,
  sanitize,
} from "./KaraokeSettings";

interface SettingsState {
  settings: KaraokeSettings;
  update: (partial: Partial<KaraokeSettings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (partial) =>
        set((state) => ({ settings: sanitize({ ...state.settings, ...partial }) })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "karaoke-settings-v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
