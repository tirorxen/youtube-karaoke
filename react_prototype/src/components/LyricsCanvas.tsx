/**
 * Canvas 60fps 逐字 fill 歌詞 widget。
 * 對應 Android `KaraokeLyricsView.kt` 與 Python `lyrics_widget.py`。
 *
 * 畫法：
 *   1. 先畫整行白色字
 *   2. 取 charsCompleted(positionMs) → 算 fill 寬度
 *   3. clipRect 後再畫一次，這次用黃色，達到逐字漸進填色
 */
import { useEffect, useRef } from "react";

import { activeLineIndex, charsCompleted } from "../lyrics/parser";
import type { Lyrics } from "../lyrics/types";

interface Props {
  lyrics: Lyrics;
  /** 拿當前播放位置（ms）；由 caller 用 ref/closure 給 60fps fresh value */
  getPositionMs: () => number;
}

const COLOR_BG = "rgba(0,0,0,0.75)";
const COLOR_PASSED = "rgba(255,255,255,0.5)";
const COLOR_INACTIVE = "#ffffff";
const COLOR_ACTIVE = "#FFC107";

const FONT_CURRENT = "bold 32px 'Microsoft JhengHei UI', 'Noto Sans TC', sans-serif";
const FONT_SIDE = "20px 'Microsoft JhengHei UI', 'Noto Sans TC', sans-serif";

export function LyricsCanvas({ lyrics, getPositionMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const positionMs = getPositionMs();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, w, h);

      if (!lyrics.lines.length) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const idx = Math.max(0, activeLineIndex(lyrics, positionMs));
      const cur = lyrics.lines[idx];
      const prev = idx >= 1 ? lyrics.lines[idx - 1] : null;
      const nxt = idx + 1 < lyrics.lines.length ? lyrics.lines[idx + 1] : null;
      const centerX = w / 2;
      const midY = h / 2;

      // 上一行
      if (prev) {
        ctx.font = FONT_SIDE;
        ctx.fillStyle = COLOR_PASSED;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(prev.text, centerX, midY - 40);
      }

      // 當前行
      if (cur) {
        ctx.font = FONT_CURRENT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // 先白色 base
        ctx.fillStyle = COLOR_INACTIVE;
        ctx.fillText(cur.text, centerX, midY);

        const completed = charsCompleted(cur, positionMs);
        if (completed > 0 && cur.text.length > 0) {
          const textWidth = ctx.measureText(cur.text).width;
          const partial = cur.text.slice(0, completed);
          const partialWidth = ctx.measureText(partial).width;
          const leftEdge = centerX - textWidth / 2;

          ctx.save();
          ctx.beginPath();
          ctx.rect(leftEdge, 0, partialWidth, h);
          ctx.clip();
          ctx.fillStyle = COLOR_ACTIVE;
          ctx.fillText(cur.text, centerX, midY);
          ctx.restore();
        }
      }

      // 下一行
      if (nxt) {
        ctx.font = FONT_SIDE;
        ctx.fillStyle = COLOR_INACTIVE;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(nxt.text, centerX, midY + 50);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [lyrics, getPositionMs]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "160px",
        display: "block",
        background: "#000",
      }}
    />
  );
}
