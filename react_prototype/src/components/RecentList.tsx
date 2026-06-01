/**
 * 最近播放清單 — 顯示在沒有載入影片時的中央空狀態畫面。
 * 點任一項一鍵重播。
 */
import { AspectRatio, Button, Card, CardContent, IconButton, Stack, Typography } from "@mui/joy";

import { useRecent } from "../recent/store";
import type { EnqueueItem } from "./SearchPanel";

interface Props {
  onPlay: (videoId: string) => void;
  /** 提供時，每張卡片多一個「＋ 歌單」按鈕。 */
  onEnqueue?: (item: EnqueueItem) => void;
}

export function RecentList({ onPlay, onEnqueue }: Props) {
  const { items, remove, clear } = useRecent();

  if (items.length === 0) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ color: "rgba(255,255,255,0.5)" }}>
        <Typography level="body-md">尚未載入影片</Typography>
        <Typography level="body-xs">
          從工具列「📋 貼上 URL」、「🔗 YouTube URL」或拖網址到此頁面
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5} sx={{ p: 2, width: "100%", maxWidth: 720 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography level="title-md">最近播放</Typography>
        <IconButton size="sm" variant="plain" onClick={() => clear()} title="清空">
          🗑
        </IconButton>
      </Stack>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ overflowX: "auto", pb: 1, "& > *": { flexShrink: 0 } }}
      >
        {items.map((item) => (
          <Card
            key={item.videoId}
            variant="outlined"
            sx={{
              width: 200,
              cursor: "pointer",
              transition: "transform 80ms",
              "&:hover": { transform: "scale(1.03)" },
            }}
            onClick={() => onPlay(item.videoId)}
          >
            <AspectRatio ratio="16/9">
              {item.thumbnail ? (
                <img src={item.thumbnail} alt={item.title} />
              ) : (
                <div style={{ background: "var(--joy-palette-primary-700)" }} />
              )}
            </AspectRatio>
            <CardContent sx={{ p: 1 }}>
              <Typography level="body-sm" noWrap title={item.title}>
                {item.title}
              </Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography level="body-xs">
                  {new Date(item.ts).toLocaleDateString()}
                </Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(item.videoId);
                  }}
                  title="從清單移除"
                >
                  ×
                </IconButton>
              </Stack>
              {onEnqueue && (
                <Button
                  size="sm"
                  variant="soft"
                  color="primary"
                  sx={{ mt: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnqueue({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail });
                  }}
                >
                  ＋ 歌單
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
