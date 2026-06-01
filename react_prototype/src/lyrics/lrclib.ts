/**
 * lrclib.net 線上歌詞備援。對應 Python `LyricsRepository.lrclib`。
 */
import { parseLrc } from "./parser";
import type { Lyrics, LyricsLine } from "./types";

export interface LrclibQuery {
  title: string;
  artist?: string | null;
  durationSec: number;
}

const ENDPOINT = "https://lrclib.net/api/get";

export async function fetchLrclib(q: LrclibQuery): Promise<Lyrics> {
  const params = new URLSearchParams({
    track_name: q.title,
    duration: String(q.durationSec),
  });
  if (q.artist) params.set("artist_name", q.artist);

  try {
    const resp = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return { source: "NONE", lines: [] };
    const data = await resp.json();
    const synced: string | undefined = data?.syncedLyrics;
    if (synced && synced.trim()) return parseLrc(synced);

    const plain: string | undefined = data?.plainLyrics;
    if (plain && plain.trim()) {
      const lines: LyricsLine[] = plain
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((t, i) => ({
          startMs: i * 4000,
          endMs: (i + 1) * 4000,
          text: t,
          wordTimings: [],
        }));
      return { source: "LRC", lines };
    }
  } catch {
    /* fall through */
  }
  return { source: "NONE", lines: [] };
}
