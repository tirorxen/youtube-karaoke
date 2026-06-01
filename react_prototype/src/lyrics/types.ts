export type LyricsSourceKind = "YOUTUBE_CC" | "LRC" | "NONE";

export interface WordTiming {
  startMs: number;
  charIndex: number;
}

export interface LyricsLine {
  startMs: number;
  endMs: number;
  text: string;
  wordTimings: WordTiming[];
}

export interface Lyrics {
  source: LyricsSourceKind;
  lines: LyricsLine[];
}
