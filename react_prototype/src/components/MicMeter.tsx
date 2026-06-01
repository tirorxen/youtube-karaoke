/**
 * MicMeter — 顯示麥克風目前峰值音量。
 * 用 AnalyserNode 接到 mic stream，requestAnimationFrame 60fps 更新。
 */
import { useEffect, useRef, useState } from "react";

import { Box, LinearProgress, Typography } from "@mui/joy";

interface Props {
  stream: MediaStream | null;
  ctx: AudioContext | null;
}

export function MicMeter({ stream, ctx }: Props) {
  const [peak, setPeak] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !ctx) {
      setPeak(0);
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > p) p = v;
      }
      setPeak(p);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [stream, ctx]);

  if (!stream) return null;
  const pct = Math.min(100, Math.round(peak * 100));
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography level="body-xs">🎙 {pct}%</Typography>
      <LinearProgress determinate value={pct} color={pct > 90 ? "warning" : "primary"} />
    </Box>
  );
}
