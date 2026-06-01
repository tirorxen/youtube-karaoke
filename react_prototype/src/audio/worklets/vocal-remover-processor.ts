/**
 * Vocal Remover AudioWorkletProcessor — 三頻段 spectral karaoke。
 *
 * 演算法（改進自純 (L-R)）：
 *   1. 用 4 個 IIR biquad（兩個 highpass、兩個 lowpass）把 stereo 切三 band：
 *        Low  : < 200Hz  → bass / kick 中央元素 → 保留原 stereo（不消音）
 *        Mid  : 200–4000Hz → 人聲主頻 → 深度 (L-R) cancellation
 *        High : > 4000Hz → cymbal / breath / 高頻泛音 → 保留原 stereo（不消音）
 *   2. Mid band 計算 side = 0.5*(L-R)，過一階 HPF 去 DC，與原音依
 *      removal/guide 比例混合
 *   3. 三 band 加總回 stereo 輸出
 *
 * 為什麼比純 (L-R) 好：純 (L-R) 對所有頻段一視同仁，會把 bass/kick 一起消掉
 * 造成「人聲是消了但底鼓也不見」；三頻段只在人聲頻段做 cancellation，
 * 保留低音震撼力與高頻空氣感，整體聽感更接近真實 KTV instrumental track。
 *
 * 公式與 [`src/benchmark/refImpl.ts::vocalRemoverRef`](../../benchmark/refImpl.ts) 同步，
 * 與 Python [`ktv/vocal_remover.py`](../../../../python_prototype/ktv/vocal_remover.py) 概念對應
 * （Python 版仍是單 band，下一輪同步升級）。
 */

import type { VocalRemoverMessage } from "../types";

const LOW_CUT_HZ = 200;
const HIGH_CUT_HZ = 4000;
const HPF_DC_HZ = 80;

/** 標準 RBJ biquad coefficients — lowpass / highpass。 */
interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  // 狀態（一個 instance 處理一個 channel）
  x1: number; x2: number; y1: number; y2: number;
}

function makeBiquad(): Biquad {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

/** RBJ "Audio EQ Cookbook" 低通 Q=0.707（一階斜率即可） */
function setLowpass(bq: Biquad, sr: number, fc: number) {
  const w0 = 2 * Math.PI * fc / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.SQRT1_2;       // 0.707
  const alpha = sin / (2 * Q);
  const b0n = (1 - cos) / 2;
  const b1n = 1 - cos;
  const b2n = (1 - cos) / 2;
  const a0 = 1 + alpha;
  const a1n = -2 * cos;
  const a2n = 1 - alpha;
  bq.b0 = b0n / a0;
  bq.b1 = b1n / a0;
  bq.b2 = b2n / a0;
  bq.a1 = a1n / a0;
  bq.a2 = a2n / a0;
}

function setHighpass(bq: Biquad, sr: number, fc: number) {
  const w0 = 2 * Math.PI * fc / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.SQRT1_2;
  const alpha = sin / (2 * Q);
  const b0n = (1 + cos) / 2;
  const b1n = -(1 + cos);
  const b2n = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1n = -2 * cos;
  const a2n = 1 - alpha;
  bq.b0 = b0n / a0;
  bq.b1 = b1n / a0;
  bq.b2 = b2n / a0;
  bq.a1 = a1n / a0;
  bq.a2 = a2n / a0;
}

function biquadStep(bq: Biquad, x: number): number {
  const y = bq.b0 * x + bq.b1 * bq.x1 + bq.b2 * bq.x2 - bq.a1 * bq.y1 - bq.a2 * bq.y2;
  bq.x2 = bq.x1;
  bq.x1 = x;
  bq.y2 = bq.y1;
  bq.y1 = y;
  return y;
}

class VocalRemoverProcessor extends AudioWorkletProcessor {
  private removal = 1.0;
  private guide = 0.3;

  // 每 channel 一個 lowpass（產生 low band）、一個 highpass（產生 high band）
  // mid band = original - low - high
  private lpL: Biquad;
  private lpR: Biquad;
  private hpL: Biquad;
  private hpR: Biquad;

  // Mid band side channel 的 DC 高通
  private dcHpfPrevIn = 0;
  private dcHpfPrevOut = 0;
  private dcHpfAlpha: number;

  constructor() {
    super();
    this.lpL = makeBiquad();
    this.lpR = makeBiquad();
    this.hpL = makeBiquad();
    this.hpR = makeBiquad();
    setLowpass(this.lpL, sampleRate, LOW_CUT_HZ);
    setLowpass(this.lpR, sampleRate, LOW_CUT_HZ);
    setHighpass(this.hpL, sampleRate, HIGH_CUT_HZ);
    setHighpass(this.hpR, sampleRate, HIGH_CUT_HZ);

    const rc = 1 / (2 * Math.PI * HPF_DC_HZ);
    const dt = 1 / sampleRate;
    this.dcHpfAlpha = rc / (rc + dt);

    this.port.onmessage = (e: MessageEvent<VocalRemoverMessage>) => {
      const msg = e.data;
      if (msg.type === "set-vocal-removal") this.removal = Math.max(0, Math.min(1, msg.value));
      else if (msg.type === "set-guide-vocal") this.guide = Math.max(0, Math.min(1, msg.value));
      else if (msg.type === "reset") {
        this.lpL.x1 = this.lpL.x2 = this.lpL.y1 = this.lpL.y2 = 0;
        this.lpR.x1 = this.lpR.x2 = this.lpR.y1 = this.lpR.y2 = 0;
        this.hpL.x1 = this.hpL.x2 = this.hpL.y1 = this.hpL.y2 = 0;
        this.hpR.x1 = this.hpR.x2 = this.hpR.y1 = this.hpR.y2 = 0;
        this.dcHpfPrevIn = 0;
        this.dcHpfPrevOut = 0;
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _params: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const lIn = input[0];
    const rIn = input[1] ?? input[0];
    const lOut = output[0];
    const rOut = output[1] ?? output[0];

    const removal = this.removal;
    const guide = this.guide;
    const dcA = this.dcHpfAlpha;
    let dcPrevIn = this.dcHpfPrevIn;
    let dcPrevOut = this.dcHpfPrevOut;

    const n = lIn.length;
    for (let i = 0; i < n; i++) {
      const l = lIn[i];
      const r = rIn[i];

      // 1) 低頻 band（low-pass）
      const lLow = biquadStep(this.lpL, l);
      const rLow = biquadStep(this.lpR, r);
      // 2) 高頻 band（high-pass）
      const lHigh = biquadStep(this.hpL, l);
      const rHigh = biquadStep(this.hpR, r);
      // 3) 中頻 band（complement）：original - low - high
      const lMid = l - lLow - lHigh;
      const rMid = r - rLow - rHigh;

      // 對 mid band 做 (L-R) cancellation
      const sideMid = 0.5 * (lMid - rMid);
      const sideMidHpf = dcA * (dcPrevOut + sideMid - dcPrevIn);
      dcPrevIn = sideMid;
      dcPrevOut = sideMidHpf;

      // mid 輸出：(1-removal) * original_mid + removal * (side + guide * original_mid)
      const lMidOut = (1 - removal) * lMid + removal * (sideMidHpf + guide * lMid);
      const rMidOut = (1 - removal) * rMid + removal * (sideMidHpf + guide * rMid);

      // low / high 永遠保留原始 stereo（不做 cancellation）
      let oL = lLow + lMidOut + lHigh;
      let oR = rLow + rMidOut + rHigh;

      if (oL < -1) oL = -1; else if (oL > 1) oL = 1;
      if (oR < -1) oR = -1; else if (oR > 1) oR = 1;
      lOut[i] = oL;
      rOut[i] = oR;
    }
    this.dcHpfPrevIn = dcPrevIn;
    this.dcHpfPrevOut = dcPrevOut;
    return true;
  }
}

registerProcessor("vocal-remover-processor", VocalRemoverProcessor);
