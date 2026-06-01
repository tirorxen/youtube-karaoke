import { describe, expect, it } from "vitest";

import { makeVocalRemoverState, vocalRemoverRef } from "../src/benchmark/refImpl";

const SR = 48_000;
const N = 4096;       // 用較長 buffer 等 biquad 穩態
const SKIP = 1024;    // 跳過前 1024 個 transient sample

function sineStereo(freqHz: number, sameLR: boolean, amp = 0.5) {
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = Math.sin((2 * Math.PI * freqHz * i) / SR) * amp;
    l[i] = v;
    r[i] = sameLR ? v : -v;
  }
  return { l, r };
}

function meanAbs(arr: Float32Array, from = SKIP) {
  let sum = 0;
  for (let i = from; i < arr.length; i++) sum += Math.abs(arr[i]);
  return sum / (arr.length - from);
}

describe("vocalRemoverRef — 三頻段 spectral karaoke", () => {
  it("mid band (1kHz) 同訊號 L=R 應被消除", () => {
    const { l, r } = sineStereo(1000, true);
    vocalRemoverRef(l, r, 1.0, 0.0, makeVocalRemoverState(SR));
    // 1kHz 在 mid band，L=R 時 (L-R)=0 → mid 應趨近 0；
    // low/high band 在 1kHz 也有少量能量但很小
    expect(meanAbs(l)).toBeLessThan(0.1);
    expect(meanAbs(r)).toBeLessThan(0.1);
  });

  it("low band (80Hz) 訊號永遠保留，即使 L=R 也不消音", () => {
    const { l, r } = sineStereo(80, true);
    const lOrig = l.slice();
    vocalRemoverRef(l, r, 1.0, 0.0, makeVocalRemoverState(SR));
    // 80Hz 在 low band，三頻段下不做 cancellation → 大部分應保留
    expect(meanAbs(l)).toBeGreaterThan(meanAbs(lOrig) * 0.5);
  });

  it("high band (8kHz) 訊號永遠保留，即使 L=R 也不消音", () => {
    const { l, r } = sineStereo(8000, true);
    const lOrig = l.slice();
    vocalRemoverRef(l, r, 1.0, 0.0, makeVocalRemoverState(SR));
    expect(meanAbs(l)).toBeGreaterThan(meanAbs(lOrig) * 0.5);
  });

  it("mid band L != R 仍保留 side channel", () => {
    const { l, r } = sineStereo(1000, false);
    vocalRemoverRef(l, r, 1.0, 0.0, makeVocalRemoverState(SR));
    expect(meanAbs(l)).toBeGreaterThan(0.05);
  });

  it("zero removal 對 mid band 是 pass-through，總輸出近原音", () => {
    const { l, r } = sineStereo(1000, false);
    const lOrig = l.slice();
    const rOrig = r.slice();
    vocalRemoverRef(l, r, 0.0, 0.0, makeVocalRemoverState(SR));
    // removal=0 時 mid 輸出 = mid 原音；low + mid + high = 原音
    // 因 biquad 有 transient，比對穩態區
    for (let i = SKIP; i < N; i++) {
      expect(l[i]).toBeCloseTo(lOrig[i], 2);
      expect(r[i]).toBeCloseTo(rOrig[i], 2);
    }
  });

  it("higher guide vocal 提升 mid band 振幅", () => {
    const a = sineStereo(1000, false);
    vocalRemoverRef(a.l, a.r, 1.0, 0.0, makeVocalRemoverState(SR));
    const ampA = meanAbs(a.l);

    const b = sineStereo(1000, false);
    vocalRemoverRef(b.l, b.r, 1.0, 0.8, makeVocalRemoverState(SR));
    const ampB = meanAbs(b.l);

    expect(ampB).toBeGreaterThan(ampA);
  });
});
