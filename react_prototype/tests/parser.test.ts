import { describe, expect, it } from "vitest";

import { parseLrc, parseSrt, parseVtt, shifted } from "../src/lyrics/parser";

describe("parseLrc", () => {
  it("parses basic LRC", () => {
    const lyrics = parseLrc("[00:01.00]第一句\n[00:05.50]第二句\n[00:10.250]第三句");
    expect(lyrics.lines.length).toBe(3);
    expect(lyrics.lines[0].startMs).toBe(1000);
    expect(lyrics.lines[1].startMs).toBe(5500);
    expect(lyrics.lines[2].startMs).toBe(10250);
    expect(lyrics.source).toBe("LRC");
  });

  it("parses multi-timestamp same line", () => {
    const lyrics = parseLrc("[00:10.00][00:30.00]副歌");
    expect(lyrics.lines.length).toBe(2);
    expect(lyrics.lines[0].text).toBe("副歌");
    expect(lyrics.lines[1].startMs).toBe(30000);
  });

  it("parses enhanced LRC inline timings", () => {
    const lyrics = parseLrc("[00:01.00]<00:01.00>第<00:01.50>一<00:02.00>句");
    const line = lyrics.lines[0];
    expect(line.text).toBe("第一句");
    expect(line.wordTimings.length).toBe(3);
    expect(line.wordTimings[0]).toEqual({ startMs: 1000, charIndex: 0 });
    expect(line.wordTimings[1]).toEqual({ startMs: 1500, charIndex: 1 });
    expect(line.wordTimings[2]).toEqual({ startMs: 2000, charIndex: 2 });
  });

  it("ignores malformed lines", () => {
    const lyrics = parseLrc("沒有時間戳\n[00:01.00]有效");
    expect(lyrics.lines.length).toBe(1);
    expect(lyrics.lines[0].text).toBe("有效");
  });

  it("shift offsets line and word timings", () => {
    const lyrics = parseLrc("[00:01.00]<00:01.00>a<00:01.50>b");
    const moved = shifted(lyrics, -500);
    expect(moved.lines[0].startMs).toBe(500);
    expect(moved.lines[0].wordTimings[0].startMs).toBe(500);
    expect(moved.lines[0].wordTimings[1].startMs).toBe(1000);
  });
});

describe("parseSrt", () => {
  it("parses basic SRT blocks", () => {
    const text =
      "1\n00:00:01,000 --> 00:00:03,500\n第一句\n\n2\n00:00:05,000 --> 00:00:07,000\n第二";
    const lyrics = parseSrt(text);
    expect(lyrics.lines.length).toBe(2);
    expect(lyrics.lines[0].startMs).toBe(1000);
    expect(lyrics.lines[0].endMs).toBe(3500);
    expect(lyrics.source).toBe("YOUTUBE_CC");
  });

  it("joins multi-line subtitle with space", () => {
    const text = "1\n00:00:01,000 --> 00:00:03,000\n第一行\n第二行";
    const lyrics = parseSrt(text);
    expect(lyrics.lines[0].text).toBe("第一行 第二行");
  });

  it("accepts dot ms separator", () => {
    const text = "1\n00:00:01.234 --> 00:00:03.567\ntest";
    const lyrics = parseSrt(text);
    expect(lyrics.lines[0].startMs).toBe(1234);
    expect(lyrics.lines[0].endMs).toBe(3567);
  });
});

describe("parseVtt (YouTube CC)", () => {
  it("strips cue settings on time line", () => {
    const text =
      "WEBVTT\nKind: captions\nLanguage: en\n\n" +
      "00:00:01.000 --> 00:00:03.000 align:start position:0%\nHello world";
    const lyrics = parseVtt(text);
    expect(lyrics.source).toBe("YOUTUBE_CC");
    expect(lyrics.lines.length).toBe(1);
    expect(lyrics.lines[0].text).toBe("Hello world");
  });

  it("strips enhanced VTT timing tags and <c> wrappers, extracts wordTimings", () => {
    // YouTube karaoke 風格的逐字 enhanced VTT
    const text =
      "WEBVTT\n\n" +
      "00:01:57.000 --> 00:02:00.000 align:start position:0%\n" +
      "<00:01:57.000><c>就</c><00:01:57.500><c>像</c><00:01:58.000><c>你</c>";
    const lyrics = parseVtt(text);
    expect(lyrics.lines.length).toBe(1);
    expect(lyrics.lines[0].text).toBe("就像你");
    expect(lyrics.lines[0].wordTimings.length).toBe(3);
    expect(lyrics.lines[0].wordTimings[0]).toEqual({ startMs: 117_000, charIndex: 0 });
    expect(lyrics.lines[0].wordTimings[1]).toEqual({ startMs: 117_500, charIndex: 1 });
    expect(lyrics.lines[0].wordTimings[2]).toEqual({ startMs: 118_000, charIndex: 2 });
  });

  it("strips <v Speaker> voice tags", () => {
    const text =
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v John>Hello there</v>";
    const lyrics = parseVtt(text);
    expect(lyrics.lines[0].text).toBe("Hello there");
  });

  it("handles classed <c.color> spans", () => {
    const text =
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c.yellow>Sing</c> along";
    const lyrics = parseVtt(text);
    expect(lyrics.lines[0].text).toBe("Sing along");
  });
});
