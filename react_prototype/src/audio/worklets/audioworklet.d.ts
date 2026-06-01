/**
 * AudioWorklet 全域作用域型別宣告。
 *
 * 為什麼需要：worklet processor 檔（*-processor.ts）執行在 AudioWorkletGlobalScope，
 * 不是 Window。TypeScript 的 DOM lib 只含主執行緒那邊的 `AudioWorkletNode`，
 * **沒有** worklet 內用的 `AudioWorkletProcessor` / `registerProcessor` / `sampleRate`
 * 等全域。少了這些宣告，`tsc --noEmit` 會對三個 processor 檔噴
 * "Cannot find name 'AudioWorkletProcessor'" 等錯誤（雖然 Vite/esbuild dev 不檢查、
 * 執行期沒問題，但會擋住 `npm run build` 的 tsc 階段）。
 *
 * 這裡補上最小宣告讓 typecheck 通過。執行期這些由瀏覽器的 AudioWorklet 提供。
 */

/** 當前 AudioContext 的取樣率（worklet 全域）。 */
declare const sampleRate: number;
/** 當前 render quantum 的起始時間（秒）。 */
declare const currentTime: number;
/** 已處理的 sample frame 數。 */
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  // 寬鬆型別：避免各 processor 子類別 process() 簽章差異造成 mismatch
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;
