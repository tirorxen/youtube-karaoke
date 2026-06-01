/**
 * Reference implementations — 純 JS 函式版本，行為與 AudioWorklet processor 一致。
 *
 * 用途：
 *   1. benchmark/latency.ts 在 main thread 量處理延遲
 *   2. vitest 單元測試直接驗證演算法行為（worklet 本身難以在 jsdom 測）
 *
 * **三頻段 spectral karaoke** 與
 * [`src/audio/worklets/vocal-remover-processor.ts`](../audio/worklets/vocal-remover-processor.ts)
 * 同步。改演算法請同時改兩處。
 */

const LOW_CUT_HZ = 200;
const HIGH_CUT_HZ = 4000;
const HPF_DC_HZ = 80;

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  x1: number; x2: number; y1: number; y2: number;
}

function makeBiquad(): Biquad {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function setLowpass(bq: Biquad, sr: number, fc: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const Q = Math.SQRT1_2, alpha = sin / (2 * Q);
  const a0 = 1 + alpha;
  bq.b0 = (1 - cos) / 2 / a0;
  bq.b1 = (1 - cos) / a0;
  bq.b2 = (1 - cos) / 2 / a0;
  bq.a1 = (-2 * cos) / a0;
  bq.a2 = (1 - alpha) / a0;
}

function setHighpass(bq: Biquad, sr: number, fc: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const Q = Math.SQRT1_2, alpha = sin / (2 * Q);
  const a0 = 1 + alpha;
  bq.b0 = (1 + cos) / 2 / a0;
  bq.b1 = -(1 + cos) / a0;
  bq.b2 = (1 + cos) / 2 / a0;
  bq.a1 = (-2 * cos) / a0;
  bq.a2 = (1 - alpha) / a0;
}

function biquadStep(bq: Biquad, x: number): number {
  const y = bq.b0 * x + bq.b1 * bq.x1 + bq.b2 * bq.x2 - bq.a1 * bq.y1 - bq.a2 * bq.y2;
  bq.x2 = bq.x1; bq.x1 = x;
  bq.y2 = bq.y1; bq.y1 = y;
  return y;
}

export interface VocalRemoverState {
  lpL: Biquad; lpR: Biquad;
  hpL: Biquad; hpR: Biquad;
  dcPrevIn: number;
  dcPrevOut: number;
  dcAlpha: number;
}

export function makeVocalRemoverState(sampleRate = 48000): VocalRemoverState {
  const lpL = makeBiquad(), lpR = makeBiquad();
  const hpL = makeBiquad(), hpR = makeBiquad();
  setLowpass(lpL, sampleRate, LOW_CUT_HZ);
  setLowpass(lpR, sampleRate, LOW_CUT_HZ);
  setHighpass(hpL, sampleRate, HIGH_CUT_HZ);
  setHighpass(hpR, sampleRate, HIGH_CUT_HZ);
  const rc = 1 / (2 * Math.PI * HPF_DC_HZ);
  const dt = 1 / sampleRate;
  return {
    lpL, lpR, hpL, hpR,
    dcPrevIn: 0, dcPrevOut: 0,
    dcAlpha: rc / (rc + dt),
  };
}

/**
 * 三頻段 spectral karaoke（與 worklet 相同公式）：
 *   - Low (<200Hz)：保留原 stereo（bass/kick 不消）
 *   - Mid (200-4kHz)：(L-R) cancellation + DC HPF + guide vocal 混回
 *   - High (>4kHz)：保留原 stereo（cymbal 不消）
 */
export function vocalRemoverRef(
  l: Float32Array,
  r: Float32Array,
  removal: number,
  guide: number,
  state: VocalRemoverState
): void {
  const { lpL, lpR, hpL, hpR, dcAlpha } = state;
  let dcPrevIn = state.dcPrevIn;
  let dcPrevOut = state.dcPrevOut;
  const n = l.length;
  for (let i = 0; i < n; i++) {
    const lv = l[i], rv = r[i];
    const lLow = biquadStep(lpL, lv);
    const rLow = biquadStep(lpR, rv);
    const lHigh = biquadStep(hpL, lv);
    const rHigh = biquadStep(hpR, rv);
    const lMid = lv - lLow - lHigh;
    const rMid = rv - rLow - rHigh;

    const sideMid = 0.5 * (lMid - rMid);
    const sideHpf = dcAlpha * (dcPrevOut + sideMid - dcPrevIn);
    dcPrevIn = sideMid;
    dcPrevOut = sideHpf;

    const lMidOut = (1 - removal) * lMid + removal * (sideHpf + guide * lMid);
    const rMidOut = (1 - removal) * rMid + removal * (sideHpf + guide * rMid);

    let oL = lLow + lMidOut + lHigh;
    let oR = rLow + rMidOut + rHigh;
    if (oL < -1) oL = -1; else if (oL > 1) oL = 1;
    if (oR < -1) oR = -1; else if (oR > 1) oR = 1;
    l[i] = oL;
    r[i] = oR;
  }
  state.dcPrevIn = dcPrevIn;
  state.dcPrevOut = dcPrevOut;
}

export function mixerRef(
  l: Float32Array,
  r: Float32Array,
  mic: Float32Array,
  gain: number
): void {
  const n = l.length;
  for (let i = 0; i < n; i++) {
    const m = mic[i] * gain;
    const oL = l[i] + m;
    const oR = r[i] + m;
    l[i] = oL < -1 ? -1 : oL > 1 ? 1 : oL;
    r[i] = oR < -1 ? -1 : oR > 1 ? 1 : oR;
  }
}
