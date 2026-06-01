/**
 * 簡化 PWA 版校準：因為瀏覽器沒有 hardware loopback API，
 * 我們用 AudioContext.baseLatency + outputLatency 作為估算，
 * 並提供「使用者敲擊節拍」的人工校準入口（未來擴充）。
 */

export interface CalibrationResult {
  baseLatencyMs: number;     // AudioContext.baseLatency
  outputLatencyMs: number;   // AudioContext.outputLatency（如果支援）
  estimateRoundTripMs: number;
}

export function calibrateContext(ctx: AudioContext | null): CalibrationResult {
  if (!ctx) {
    return { baseLatencyMs: 0, outputLatencyMs: 0, estimateRoundTripMs: -1 };
  }
  const base = (ctx.baseLatency ?? 0) * 1000;
  const out =
    typeof ctx.outputLatency === "number" ? ctx.outputLatency * 1000 : 0;
  const est = Math.max(base + out, base);
  return {
    baseLatencyMs: base,
    outputLatencyMs: out,
    estimateRoundTripMs: Math.round(est),
  };
}
