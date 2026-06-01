import { describe, expect, it } from "vitest";

import { mixerRef } from "../src/benchmark/refImpl";

describe("mixerRef", () => {
  it("adds mic to both channels with gain", () => {
    const l = new Float32Array([0.1, 0.2, 0.3]);
    const r = new Float32Array([-0.1, -0.2, -0.3]);
    const mic = new Float32Array([0.05, 0.05, 0.05]);
    mixerRef(l, r, mic, 1.0);
    expect(l[0]).toBeCloseTo(0.15);
    expect(r[0]).toBeCloseTo(-0.05);
  });

  it("scales mic by gain", () => {
    const l = new Float32Array([0]);
    const r = new Float32Array([0]);
    const mic = new Float32Array([0.2]);
    mixerRef(l, r, mic, 1.5);
    expect(l[0]).toBeCloseTo(0.3);
  });

  it("clips at ±1", () => {
    const l = new Float32Array([0.9]);
    const r = new Float32Array([0.9]);
    const mic = new Float32Array([0.9]);
    mixerRef(l, r, mic, 2.0);
    expect(l[0]).toBeLessThanOrEqual(1.0);
    expect(r[0]).toBeLessThanOrEqual(1.0);
  });
});
