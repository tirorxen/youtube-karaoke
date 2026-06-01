/**
 * Latency benchmark — 在 main thread 跑 reference 演算法版本，量測中位延遲。
 *
 * 為什麼不直接量 worklet 內延遲？
 * - AudioWorkletProcessor 沒有公開的 timing API
 * - 但 worklet 的演算法跟 reference impl 1:1（同公式），main thread 量到的時間
 *   能對 Worklet bottleneck 提供大致估計
 *
 * 對應 Python `ktv/latency.py::run_benchmarks`。
 */

import { makeVocalRemoverState, vocalRemoverRef, mixerRef } from "./refImpl";

export interface BenchmarkRow {
  name: string;
  medianUs: number;
  maxUs: number;
  iterations: number;
  passesBudget: boolean;
  budgetUs: number;
}

function measure(fn: () => void, iterations = 200): { medianUs: number; maxUs: number } {
  for (let i = 0; i < 5; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push((performance.now() - t0) * 1000); // µs
  }
  samples.sort((a, b) => a - b);
  return {
    medianUs: samples[Math.floor(samples.length / 2)],
    maxUs: samples[samples.length - 1],
  };
}

export function callbackBudgetUs(bufferSize: number, sampleRate = 48000): number {
  return ((bufferSize / sampleRate) * 1_000_000) * 0.8;
}

export function runBenchmarks(bufferSize = 256, sampleRate = 48000): BenchmarkRow[] {
  const budget = callbackBudgetUs(bufferSize, sampleRate);
  const lBuf = new Float32Array(bufferSize);
  const rBuf = new Float32Array(bufferSize);
  for (let i = 0; i < bufferSize; i++) {
    lBuf[i] = Math.sin(i * 0.1) * 0.3;
    rBuf[i] = Math.sin(i * 0.13) * 0.3;
  }

  const vocalState = makeVocalRemoverState(sampleRate);
  const vocalFn = () => {
    const l = new Float32Array(lBuf);
    const r = new Float32Array(rBuf);
    vocalRemoverRef(l, r, 1.0, 0.3, vocalState);
  };
  const v = measure(vocalFn);

  const mic = new Float32Array(bufferSize);
  for (let i = 0; i < bufferSize; i++) mic[i] = Math.sin(i * 0.07) * 0.2;
  const mixFn = () => {
    const l = new Float32Array(lBuf);
    const r = new Float32Array(rBuf);
    mixerRef(l, r, mic, 1.0);
  };
  const m = measure(mixFn);

  const chainState = makeVocalRemoverState(sampleRate);
  const chainFn = () => {
    const l = new Float32Array(lBuf);
    const r = new Float32Array(rBuf);
    vocalRemoverRef(l, r, 1.0, 0.3, chainState);
    mixerRef(l, r, mic, 1.0);
  };
  const c = measure(chainFn);

  return [
    rowOf("vocal_remover.process", v, budget),
    rowOf("mixer.mix_into_stereo", m, budget),
    rowOf("end_to_end_dsp_chain", c, budget),
  ];
}

function rowOf(
  name: string,
  s: { medianUs: number; maxUs: number },
  budget: number
): BenchmarkRow {
  return {
    name,
    medianUs: s.medianUs,
    maxUs: s.maxUs,
    iterations: 200,
    budgetUs: budget,
    passesBudget: s.medianUs < budget,
  };
}

export function formatReport(rows: BenchmarkRow[], bufferSize = 256): string {
  const budget = callbackBudgetUs(bufferSize);
  const lines = [
    `## Latency Benchmark (buffer=${bufferSize} frames @ 48kHz)`,
    `Per-callback budget: ${budget.toFixed(1)} µs (20% headroom)`,
    ``,
    `| Module | Median (µs) | Max (µs) | Pass |`,
    `|---|---:|---:|:---:|`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.medianUs.toFixed(1)} | ${r.maxUs.toFixed(1)} | ${r.passesBudget ? "✅" : "❌"} |`
    );
  }
  return lines.join("\n");
}
