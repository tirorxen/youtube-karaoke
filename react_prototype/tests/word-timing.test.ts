import { describe, expect, it } from "vitest";

import { activeLineIndex, charsCompleted, parseLrc } from "../src/lyrics/parser";
import type { LyricsLine } from "../src/lyrics/types";

const line = (s: Partial<LyricsLine>): LyricsLine => ({
  startMs: 0,
  endMs: 1000,
  text: "",
  wordTimings: [],
  ...s,
});

describe("charsCompleted", () => {
  it("linear interpolation when no word timings", () => {
    const l = line({ startMs: 0, endMs: 1000, text: "abcd" });
    expect(charsCompleted(l, 0)).toBe(0);
    expect(charsCompleted(l, 500)).toBe(2);
    expect(charsCompleted(l, 1000)).toBe(4);
  });

  it("uses word timings when available", () => {
    const l = line({
      startMs: 1000,
      endMs: 3000,
      text: "第一句",
      wordTimings: [
        { startMs: 1000, charIndex: 0 },
        { startMs: 1500, charIndex: 1 },
        { startMs: 2000, charIndex: 2 },
      ],
    });
    expect(charsCompleted(l, 900)).toBe(0);
    expect(charsCompleted(l, 1100)).toBe(0);
    expect(charsCompleted(l, 1600)).toBe(1);
    expect(charsCompleted(l, 2500)).toBe(2);
    expect(charsCompleted(l, 3100)).toBe(3);
  });

  it("empty text returns 0", () => {
    expect(charsCompleted(line({ text: "" }), 500)).toBe(0);
  });
});

describe("activeLineIndex", () => {
  it("finds the current line", () => {
    const lyrics = parseLrc("[00:00.00]a\n[00:05.00]b\n[00:10.00]c");
    expect(activeLineIndex(lyrics, 2000)).toBe(0);
    expect(activeLineIndex(lyrics, 7000)).toBe(1);
    expect(activeLineIndex(lyrics, 12000)).toBe(2);
  });

  it("returns -1 before first line", () => {
    const lyrics = parseLrc("[00:05.00]a");
    expect(activeLineIndex(lyrics, 0)).toBe(-1);
  });
});
