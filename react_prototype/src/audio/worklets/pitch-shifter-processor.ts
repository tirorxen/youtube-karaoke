/**
 * Pitch Shifter AudioWorkletProcessor — 雙讀頭 delay-line granular pitch shift。
 *
 * 演算法（經典「兩個 cross-fading 讀指針」變調器，吉他效果器常用）：
 *   - 維護一條 ring buffer（delay line）
 *   - 兩個讀指針相位差半個 window，各自以「(1 - ratio)」速度漂移
 *   - 兩讀指針用三角窗 cross-fade，掩蓋指針 wrap 時的不連續
 *   - 升 pitch（ratio>1）→ 讀指針追寫指針 → 取樣更新的音訊 → 音高升高、長度不變
 *
 * 為什麼不用之前的線性 resample？那會同時改變 tempo + 破壞相位 → 「地獄音」。
 * 這個雙讀頭法即時、無 lookahead 延遲、tempo 不變，KTV 伴奏變調夠用
 * （純音樂上有輕微 warble，但遠優於線性 resample）。
 *
 * semitones == 0 時走 pass-through（零成本、零 artifact），但仍持續寫 ring buffer
 * 確保切到非 0 時不會有 pop。
 *
 * 男女聲預設疊加在 semitones 上由 main thread 算好（effectiveSemitones）後傳入。
 */
import type { PitchShifterMessage } from "../types";

const WINDOW = 2048;          // delay line / grain 視窗大小（~46ms @ 44.1k）
const HALF = WINDOW / 2;

class PitchShifterProcessor extends AudioWorkletProcessor {
  private semitones = 0;
  private ratio = 1;

  private ringL = new Float32Array(WINDOW);
  private ringR = new Float32Array(WINDOW);
  private writePos = 0;
  private phase = 0;          // 0..WINDOW，讀指針相對寫指針的 delay

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<PitchShifterMessage>) => {
      const msg = e.data;
      if (msg.type === "set-effective-semitones") {
        const s = Math.max(-12, Math.min(12, Math.round(msg.value)));
        this.semitones = s;
        this.ratio = Math.pow(2, s / 12);
      } else if (msg.type === "reset") {
        this.ringL.fill(0);
        this.ringR.fill(0);
        this.writePos = 0;
        this.phase = 0;
      }
    };
  }

  /** 三角窗：p=0 → 0，p=HALF → 1，p=WINDOW → 0。掩蓋讀指針 wrap 的不連續。 */
  private triWindow(p: number): number {
    return 1 - Math.abs((2 * p) / WINDOW - 1);
  }

  /** 線性內插讀 ring buffer（往回 delay 個 sample）。 */
  private readInterp(ring: Float32Array, delay: number): number {
    // 讀位置 = writePos - delay（環形）
    let pos = this.writePos - delay;
    while (pos < 0) pos += WINDOW;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = (i0 + 1) % WINDOW;
    return ring[i0] * (1 - frac) + ring[i1] * frac;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    const lIn = input[0];
    const rIn = input[1] ?? input[0];
    const lOut = output[0];
    const rOut = output[1] ?? output[0];
    const n = lOut.length;

    // pass-through（零半音）— 但仍寫 ring buffer 保持連續
    if (this.semitones === 0) {
      for (let i = 0; i < n; i++) {
        this.ringL[this.writePos] = lIn[i];
        this.ringR[this.writePos] = rIn[i];
        this.writePos = (this.writePos + 1) % WINDOW;
        lOut[i] = lIn[i];
        rOut[i] = rIn[i];
      }
      return true;
    }

    const drift = 1 - this.ratio;   // 每 sample phase 增量
    for (let i = 0; i < n; i++) {
      // 寫入新 sample
      this.ringL[this.writePos] = lIn[i];
      this.ringR[this.writePos] = rIn[i];

      // 兩個讀指針，相位差 HALF
      const p1 = this.phase;
      const p2 = (this.phase + HALF) % WINDOW;
      const w1 = this.triWindow(p1);
      const w2 = this.triWindow(p2);

      lOut[i] = this.readInterp(this.ringL, p1) * w1 + this.readInterp(this.ringL, p2) * w2;
      rOut[i] = this.readInterp(this.ringR, p1) * w1 + this.readInterp(this.ringR, p2) * w2;

      // 推進 phase（環形）
      this.phase += drift;
      while (this.phase < 0) this.phase += WINDOW;
      while (this.phase >= WINDOW) this.phase -= WINDOW;

      this.writePos = (this.writePos + 1) % WINDOW;
    }
    return true;
  }
}

registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
