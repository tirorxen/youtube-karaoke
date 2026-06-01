/**
 * KaraokeSettings：與 Python `ktv/settings.py::KaraokeSettings` 1:1 對齊，
 * 也與 Android `KaraokeSettings.kt` 同欄位、同預設值。
 *
 * 修改任一處請同步另外兩個版本，避免行為漂移。
 */

export type GenderPreset = "OFF" | "MALE_TO_FEMALE" | "FEMALE_TO_MALE";
export type YouTubeSourceMode = "PERSONAL" | "IFRAME";
export type MicSource = "USB" | "BLUETOOTH" | "BUILTIN" | "COMPANION";

/**
 * demucs 分離模型 — 速度/品質權衡：
 *   - htdemucs：**單一** transformer 模型，預設；CPU ~1-2 分鐘/首，品質很好
 *   - mdx_extra_q：**4 個** MDX 模型集成（bag of 4），品質頂尖但慢 3-4x（~4-8 分鐘）
 *   - htdemucs_ft：htdemucs fine-tuned 版，品質更好但慢
 */
export type DemucsModel = "htdemucs" | "mdx_extra_q" | "htdemucs_ft";

export interface KaraokeSettings {
  guideVocalPercent: number;       // 0..100
  pitchSemitones: number;          // -12..+12
  genderPreset: GenderPreset;
  bufferSize: 128 | 256 | 512 | 1024;
  subtitleOffsetMs: number;        // -1000..+1000 (step 10)
  micAlignmentMs: number;          // 0..500 (step 5)
  micGainPercent: number;          // 0..200
  autoRerunVocalRemoval: boolean;
  youtubeSourceMode: YouTubeSourceMode;
  micSource: MicSource;
  measuredRoundTripMs: number;     // -1 = uncalibrated
  highQualityVocalRemoval: boolean;
  demucsModel: DemucsModel;
  autoTriggerHighQuality: boolean;   // Hotfix #5：載入新歌自動跑 demucs
}

export const DEFAULT_SETTINGS: KaraokeSettings = {
  guideVocalPercent: 30,
  pitchSemitones: 0,
  genderPreset: "OFF",
  bufferSize: 256,
  subtitleOffsetMs: 0,
  micAlignmentMs: 0,
  micGainPercent: 100,
  autoRerunVocalRemoval: true,
  youtubeSourceMode: "IFRAME",     // PWA 只能 IFrame
  micSource: "BUILTIN",
  measuredRoundTripMs: -1,
  highQualityVocalRemoval: false,
  demucsModel: "htdemucs",
  autoTriggerHighQuality: true,
};

/** 對應 Python guide_vocal_level / mic_gain / vocal_removal_level properties。 */
export const guideVocalLevel = (s: KaraokeSettings) => s.guideVocalPercent / 100;
export const micGain = (s: KaraokeSettings) => s.micGainPercent / 100;
export const vocalRemovalLevel = (_s: KaraokeSettings) => 1.0;

/** 與 Python `effective_semitones()` 完全一樣的合成邏輯。 */
export function effectiveSemitones(s: KaraokeSettings): number {
  const delta =
    s.genderPreset === "MALE_TO_FEMALE" ? 5 :
    s.genderPreset === "FEMALE_TO_MALE" ? -5 : 0;
  return Math.max(-12, Math.min(12, s.pitchSemitones + delta));
}

/** 套用 clamp 範圍；接受任意 partial 後 sanitize 出合法 settings。 */
export function sanitize(s: Partial<KaraokeSettings>): KaraokeSettings {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const merged = { ...DEFAULT_SETTINGS, ...s };
  return {
    ...merged,
    guideVocalPercent: clamp(merged.guideVocalPercent, 0, 100),
    pitchSemitones: clamp(merged.pitchSemitones, -12, 12),
    bufferSize: ([128, 256, 512, 1024] as const).includes(merged.bufferSize as any)
      ? merged.bufferSize
      : 256,
    subtitleOffsetMs: clamp(merged.subtitleOffsetMs, -1000, 1000),
    micAlignmentMs: clamp(merged.micAlignmentMs, 0, 500),
    micGainPercent: clamp(merged.micGainPercent, 0, 200),
  };
}
