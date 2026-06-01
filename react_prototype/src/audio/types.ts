/**
 * AudioWorklet 與 main thread 溝通的 message types。
 *
 * Worklet 內部不能直接讀 main thread state，所以全部 setter 都透過
 * `port.postMessage({type: "set-vocal-removal", value: 0.8})`。
 */

export type VocalRemoverMessage =
  | { type: "set-vocal-removal"; value: number }
  | { type: "set-guide-vocal"; value: number }
  | { type: "reset" };

export type MixerMessage =
  | { type: "set-mic-gain"; value: number }
  | { type: "set-mic-alignment-ms"; value: number; sampleRate: number }
  | { type: "reset" };

export type PitchShifterMessage =
  | { type: "set-effective-semitones"; value: number }
  | { type: "reset" };
