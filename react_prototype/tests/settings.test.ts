import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  effectiveSemitones,
  guideVocalLevel,
  micGain,
  sanitize,
  vocalRemovalLevel,
} from "../src/settings/KaraokeSettings";

describe("KaraokeSettings defaults & helpers", () => {
  it("matches Python/Android defaults", () => {
    const s = DEFAULT_SETTINGS;
    expect(s.guideVocalPercent).toBe(30);
    expect(s.pitchSemitones).toBe(0);
    expect(s.genderPreset).toBe("OFF");
    expect(s.bufferSize).toBe(256);
    expect(s.micGainPercent).toBe(100);
    expect(s.autoRerunVocalRemoval).toBe(true);
  });

  it("guideVocalLevel maps to 0..1", () => {
    expect(guideVocalLevel({ ...DEFAULT_SETTINGS, guideVocalPercent: 50 })).toBe(0.5);
  });

  it("micGain 200 = double", () => {
    expect(micGain({ ...DEFAULT_SETTINGS, micGainPercent: 200 })).toBe(2);
  });

  it("vocalRemovalLevel always 1", () => {
    expect(vocalRemovalLevel(DEFAULT_SETTINGS)).toBe(1.0);
  });
});

describe("effectiveSemitones", () => {
  it("MALE_TO_FEMALE adds 5", () => {
    expect(effectiveSemitones({ ...DEFAULT_SETTINGS, genderPreset: "MALE_TO_FEMALE" })).toBe(5);
  });
  it("FEMALE_TO_MALE subtracts 5", () => {
    expect(effectiveSemitones({ ...DEFAULT_SETTINGS, genderPreset: "FEMALE_TO_MALE" })).toBe(-5);
  });
  it("composes with pitch", () => {
    expect(
      effectiveSemitones({ ...DEFAULT_SETTINGS, pitchSemitones: 3, genderPreset: "MALE_TO_FEMALE" })
    ).toBe(8);
  });
  it("clamps to [-12, 12]", () => {
    expect(
      effectiveSemitones({ ...DEFAULT_SETTINGS, pitchSemitones: 10, genderPreset: "MALE_TO_FEMALE" })
    ).toBe(12);
    expect(
      effectiveSemitones({ ...DEFAULT_SETTINGS, pitchSemitones: -10, genderPreset: "FEMALE_TO_MALE" })
    ).toBe(-12);
  });
});

describe("sanitize", () => {
  it("clamps out-of-range numbers", () => {
    const s = sanitize({
      guideVocalPercent: 200,
      pitchSemitones: 99,
      subtitleOffsetMs: 5000,
      micAlignmentMs: 999,
      micGainPercent: -50,
    });
    expect(s.guideVocalPercent).toBe(100);
    expect(s.pitchSemitones).toBe(12);
    expect(s.subtitleOffsetMs).toBe(1000);
    expect(s.micAlignmentMs).toBe(500);
    expect(s.micGainPercent).toBe(0);
  });

  it("falls back to 256 buffer size for invalid value", () => {
    const s = sanitize({ bufferSize: 999 as any });
    expect(s.bufferSize).toBe(256);
  });
});
