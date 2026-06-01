/**
 * 「不知道要唱什麼」隨機推薦 — 從已唱歷史抽 6 首給靈感。
 *
 * 真．類似曲風推薦演算法太重（要呼叫 YouTube 相關推薦 API 或音樂特徵分析），
 * 先用洗牌頂著。使用者點「🎲 再洗一次」就重抽。
 * 沒唱過任何歌時不顯示（會由 RecentList 的空狀態接住）。
 */
import { AspectRatio, Box, Button, Card, CardContent, Stack, Typography } from "@mui/joy";
import { useState } from "react";

import { usePlayedHistory, type PlayedItem } from "../played/store";
import type { EnqueueItem } from "./SearchPanel";

interface Props {
  onPlay: (videoId: string) => void;
  onEnqueue?: (item: EnqueueItem) => void;
}

export function RandomRecommend({ onPlay, onEnqueue }: Props) {
  const pickRandom = usePlayedHistory((s) => s.pickRandom);
  const total = usePlayedHistory((s) => s.items.length);
  const [picks, setPicks] = useState<PlayedItem[]>(() => pickRandom(6));

  if (total === 0) return null;

  return (
    <Stack spacing={1.5} sx={{ p: 2, width: "100%", maxWidth: 980 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography level="title-md">🎲 不知道要唱什麼？從你唱過的歌隨機抽</Typography>
        <Button size="sm" variant="outlined" onClick={() => setPicks(pickRandom(6))}>
          🎲 再洗一次
        </Button>
      </Stack>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ overflowX: "auto", pb: 1, "& > *": { flexShrink: 0 } }}
      >
        {picks.map((item) => (
          <Card
            key={item.videoId}
            variant="outlined"
            sx={{
              width: 180, cursor: "pointer",
              transition: "transform 80ms",
              "&:hover": { transform: "scale(1.03)" },
            }}
            onClick={() => onPlay(item.videoId)}
          >
            <AspectRatio ratio="16/9">
              {item.thumbnail ? (
                <img src={item.thumbnail} alt={item.title} loading="lazy" />
              ) : (
                <div style={{ background: "var(--joy-palette-primary-700)" }} />
              )}
            </AspectRatio>
            <CardContent sx={{ p: 1 }}>
              <Typography level="body-sm" noWrap title={item.title}>
                {item.title}
              </Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.25 }}>
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  唱過 {item.playCount} 次
                </Typography>
                {onEnqueue && (
                  <Button
                    size="sm" variant="plain" color="primary" sx={{ minHeight: 22, py: 0, px: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnqueue({
                        videoId: item.videoId,
                        title: item.title,
                        thumbnail: item.thumbnail,
                        durationSec: item.durationSec,
                      });
                    }}
                  >
                    ＋ 歌單
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {picks.length === 0 && (
          <Box sx={{ p: 2, opacity: 0.5 }}>
            <Typography level="body-sm">（沒有可推薦的歌；多唱幾首再回來）</Typography>
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
