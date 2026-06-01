/**
 * LRC / Enhanced LRC / SRT / VTT 解析。
 *
 * 演算法行為與 Python `ktv/lyrics.py` 1:1 對齊，
 * 同樣的 fixture 在三套（Python / TS / Android Kotlin）都應回傳同樣結果。
 */
import type { Lyrics, LyricsLine, WordTiming } from "./types";

const LRC_LINE_RE = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
const LRC_INLINE_RE = /<(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?>/g;
const SRT_TIME_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function timestampToMs(min: string, sec: string, frac: string): number {
  const m = Number(min);
  const s = Number(sec);
  const f = Number((frac || "0").padEnd(3, "0").slice(0, 3));
  return (m * 60 + s) * 1000 + f;
}

function extractInlineWordTimings(content: string): {
  clean: string;
  timings: WordTiming[];
} {
  if (!content.includes("<")) return { clean: content, timings: [] };

  const outParts: string[] = [];
  const timings: WordTiming[] = [];
  let pos = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(LRC_INLINE_RE.source, "g");
  while ((match = regex.exec(content)) !== null) {
    outParts.push(content.slice(pos, match.index));
    const charIdx = outParts.reduce((sum, p) => sum + p.length, 0);
    timings.push({
      startMs: timestampToMs(match[1], match[2], match[3] || ""),
      charIndex: charIdx,
    });
    pos = match.index + match[0].length;
  }
  outParts.push(content.slice(pos));
  return { clean: outParts.join(""), timings };
}

export function parseLrc(text: string): Lyrics {
  const parsed: Array<{ ms: number; text: string; timings: WordTiming[] }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const matches: RegExpExecArray[] = [];
    LRC_LINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LRC_LINE_RE.exec(raw)) !== null) matches.push(m);
    if (matches.length === 0) continue;

    const last = matches[matches.length - 1];
    const contentRaw = raw.slice(last.index + last[0].length).trim();
    if (!contentRaw) continue;
    const { clean, timings } = extractInlineWordTimings(contentRaw);
    if (!clean) continue;

    for (const mm of matches) {
      parsed.push({
        ms: timestampToMs(mm[1], mm[2], mm[3] || ""),
        text: clean,
        timings,
      });
    }
  }
  parsed.sort((a, b) => a.ms - b.ms);

  const lines: LyricsLine[] = parsed.map((p, i) => ({
    startMs: p.ms,
    endMs: parsed[i + 1]?.ms ?? p.ms + 5000,
    text: p.text,
    wordTimings: p.timings,
  }));
  return { source: "LRC", lines };
}

export function parseSrt(text: string): Lyrics {
  const blocks = text.split(/\r?\n\r?\n/);
  const lines: LyricsLine[] = [];
  for (const block of blocks) {
    const m = block.match(SRT_TIME_RE);
    if (!m) continue;
    const startMs =
      ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) + Number(m[4]);
    const endMs =
      ((Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7])) * 1000) + Number(m[8]);
    const idx = (block.indexOf(m[0]) ?? 0) + m[0].length;
    const content = block.slice(idx).trim();
    const text = content
      .split(/\r?\n/)
      .filter((s) => s.trim())
      .join(" ");
    if (text) lines.push({ startMs, endMs, text, wordTimings: [] });
  }
  return { source: "YOUTUBE_CC", lines };
}

/**
 * VTT 解析（YouTube CC 專用）。
 *
 * 為什麼不直接 reuse parseSrt：YouTube 的 VTT 比 SRT 多兩種惡心東西，純 SRT
 * parser 會把它們當歌詞文字直接吐出來，舞台上看到的就是
 * "align:start position:0% <00:01:57.000><c>就</c>..." 這種大字亂碼。
 *
 *   1. cue settings：時間軸那行尾巴的 "align:start position:0%" 之類
 *   2. enhanced timing：行內逐字時間戳 <HH:MM:SS.mmm><c>字</c>
 *   3. voice tags：<v Speaker>...</v>
 *
 * 這版會：cue settings 丟掉、enhanced timing 抽出來變 wordTimings（給逐字 fill 用）、
 * 其他 tag 一律剝掉，最後文字乾乾淨淨。
 */
export function parseVtt(text: string): Lyrics {
  // 去掉 WEBVTT header 區塊（第一個空行之前的內容）
  let body = text.replace(/^﻿/, "");   // 有時 BOM
  const headerEnd = body.search(/\r?\n\r?\n/);
  if (/^WEBVTT/i.test(body) && headerEnd !== -1) {
    body = body.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  }

  const blocks = body.split(/\r?\n\r?\n/);
  const lines: LyricsLine[] = [];
  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;
    const m = trimmedBlock.match(SRT_TIME_RE);
    if (!m) continue;
    const startMs =
      ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) + Number(m[4]);
    const endMs =
      ((Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7])) * 1000) + Number(m[8]);

    // 把「時間那一整行」（含尾巴 cue settings）切掉
    const timeIdx = trimmedBlock.indexOf(m[0]);
    let after = trimmedBlock.slice(timeIdx + m[0].length);
    const nl = after.indexOf("\n");
    after = nl === -1 ? "" : after.slice(nl + 1);
    const rawText = after.trim();
    if (!rawText) continue;

    const joined = rawText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");

    const { clean, timings } = extractVttInlineTimings(joined);
    if (!clean) continue;

    lines.push({ startMs, endMs, text: clean, wordTimings: timings });
  }
  return { source: "YOUTUBE_CC", lines };
}

/**
 * VTT 文字內的 enhanced timing / voice / class tag 處理：
 *   - <HH:MM:SS.mmm>  抽出來成 wordTimings（給逐字 fill 用）
 *   - <c>...</c>、<c.color>...</c>  保留中間文字、剝 tag
 *   - <v Speaker>...</v>  保留中間文字、剝 tag
 *   - 其他 <...>  一律剝掉
 *   - 連續空白縮成單一空格
 */
function extractVttInlineTimings(content: string): { clean: string; timings: WordTiming[] } {
  if (!content) return { clean: "", timings: [] };

  // 1. 先剝掉所有「非時間戳」的 tag：<c>、<c.color>、<v Speaker>、</v> 等。
  //    時間戳格式 `<\d+:\d+:\d+\.\d+>` 含冒號+點，其他 tag 不含 → 用 negative
  //    lookahead 排除真正的時間戳，其他 <...> 一律剝掉。
  //    這樣 charIndex 是針對「最終 clean 文字」算的，不是針對含 tag 的中間態。
  const stripped = content.replace(/<(?!\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}>)[^>]*>/g, "");

  // 2. 走一遍剩下的「文字 + 時間戳」，把時間戳抽出來成 wordTimings
  const timings: WordTiming[] = [];
  const outParts: string[] = [];
  let pos = 0;
  const tsRe = /<(\d{1,2}):(\d{1,2}):(\d{1,2})\.(\d{1,3})>/g;
  let m: RegExpExecArray | null;
  while ((m = tsRe.exec(stripped)) !== null) {
    outParts.push(stripped.slice(pos, m.index));
    const totalMs =
      ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) + Number(m[4]);
    const charIdx = outParts.reduce((s, p) => s + p.length, 0);
    timings.push({ startMs: totalMs, charIndex: charIdx });
    pos = m.index + m[0].length;
  }
  outParts.push(stripped.slice(pos));

  // 3. 連續空白縮成單一空格
  const clean = outParts.join("").replace(/\s+/g, " ").trim();

  return { clean, timings };
}

/** 對應 Python LyricsLine.chars_completed(position_ms)。 */
export function charsCompleted(line: LyricsLine, positionMs: number): number {
  if (!line.text) return 0;
  if (positionMs <= line.startMs) return 0;
  if (positionMs >= line.endMs) return line.text.length;

  if (line.wordTimings.length > 0) {
    for (let i = line.wordTimings.length - 1; i >= 0; i--) {
      const w = line.wordTimings[i];
      if (positionMs >= w.startMs) {
        const next = line.wordTimings[i + 1];
        const nextStart = next?.startMs ?? line.endMs;
        const nextChar = next?.charIndex ?? line.text.length;
        if (positionMs >= nextStart) return nextChar;
        const span = Math.max(1, nextStart - w.startMs);
        const frac = (positionMs - w.startMs) / span;
        return w.charIndex + Math.floor((nextChar - w.charIndex) * frac);
      }
    }
    return 0;
  }
  const total = line.endMs - line.startMs;
  if (total <= 0) return line.text.length;
  return Math.max(0, Math.min(line.text.length,
    Math.floor((line.text.length * (positionMs - line.startMs)) / total)));
}

export function activeLineIndex(lyrics: Lyrics, positionMs: number): number {
  for (let i = 0; i < lyrics.lines.length; i++) {
    const ln = lyrics.lines[i];
    if (positionMs >= ln.startMs && positionMs <= ln.endMs) return i;
  }
  let last = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if (positionMs > lyrics.lines[i].endMs) last = i;
  }
  return last;
}

export function shifted(lyrics: Lyrics, offsetMs: number): Lyrics {
  return {
    source: lyrics.source,
    lines: lyrics.lines.map((ln) => ({
      startMs: ln.startMs + offsetMs,
      endMs: ln.endMs + offsetMs,
      text: ln.text,
      wordTimings: ln.wordTimings.map((w) => ({
        startMs: w.startMs + offsetMs,
        charIndex: w.charIndex,
      })),
    })),
  };
}

/** 依副檔名選 parser。 */
export function parseByExtension(filename: string, content: string): Lyrics {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".lrc")) return parseLrc(content);
  if (lower.endsWith(".srt")) return parseSrt(content);
  if (lower.endsWith(".vtt")) return parseVtt(content);
  return { source: "NONE", lines: [] };
}
