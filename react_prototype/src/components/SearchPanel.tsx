/**
 * 在 KTV 視窗內直接搜尋 YouTube。
 *
 * 不需要 YouTube Data API key — backend 用 yt-dlp `ytsearch10:keyword`
 * 從 YouTube 公開搜尋介面拿結果。
 *
 * 結果以 thumbnail grid 顯示，點任一張就 onPick(videoId)。
 */
import {
  AspectRatio,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Input,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import { useState } from "react";

import { searchYouTube, type YouTubeSearchResult } from "../youtube/backendClient";

export interface EnqueueItem {
  videoId: string;
  title: string;
  thumbnail?: string | null;
  durationSec?: number;
}

interface Props {
  onPick: (videoId: string) => void;
  /** 提供時，每張卡片多一個「＋ 加入歌單」按鈕。 */
  onEnqueue?: (item: EnqueueItem) => void;
}

function formatDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SearchPanel({ onPick, onEnqueue }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setErr(null);
    setResults([]);
    try {
      const r = await searchYouTube(query, 12);
      setResults(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet sx={{ p: 2, width: "100%", maxWidth: 980 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Input
          placeholder="🔍 搜尋 YouTube（歌手 + 歌名、卡拉 OK、live 等）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          sx={{ flex: 1 }}
          size="md"
          autoFocus
        />
        <Button onClick={submit} disabled={loading || !q.trim()}>
          {loading ? <CircularProgress size="sm" /> : "搜尋"}
        </Button>
      </Stack>

      {err && (
        <Typography color="danger" level="body-sm" sx={{ mb: 1 }}>
          搜尋失敗：{err}
        </Typography>
      )}

      {results.length > 0 && (
        <Stack
          direction="row"
          flexWrap="wrap"
          spacing={1.5}
          useFlexGap
          sx={{ "& > *": { flexBasis: { xs: "100%", sm: "calc(50% - 12px)", md: "calc(33.333% - 12px)" } } }}
        >
          {results.map((r) => (
            <Card
              key={r.videoId}
              variant="outlined"
              sx={{
                cursor: "pointer",
                transition: "transform 100ms",
                "&:hover": { transform: "scale(1.02)" },
              }}
              onClick={() => onPick(r.videoId)}
            >
              <AspectRatio ratio="16/9" sx={{ position: "relative" }}>
                {r.thumbnail ? (
                  <img src={r.thumbnail} alt={r.title} loading="lazy" />
                ) : (
                  <div style={{ background: "var(--joy-palette-primary-700)" }} />
                )}
                {/* CC 字幕標記：右上角小徽章。manual=綠（最準）、auto=黃（同語 ASR）、無=不顯示 */}
                {(r.hasManualCaptions || r.hasAutoCaptions) && (
                  <Box
                    sx={{
                      position: "absolute", top: 4, right: 4,
                      px: 0.75, py: 0.25, borderRadius: 4,
                      background: r.hasManualCaptions ? "rgba(62,207,142,0.92)" : "rgba(255,206,77,0.92)",
                      color: "#0a0d18", fontSize: 11, fontWeight: 800,
                      letterSpacing: 0.5,
                    }}
                    title={r.hasManualCaptions ? "有人工上傳字幕（最準）" : "只有 YT 自動字幕"}
                  >
                    CC
                  </Box>
                )}
                {r.detectedLang && (
                  <Box
                    sx={{
                      position: "absolute", top: 4, left: 4,
                      px: 0.75, py: 0.25, borderRadius: 4,
                      background: "rgba(0,0,0,0.55)", color: "#fff",
                      fontSize: 10, textTransform: "uppercase", fontWeight: 600,
                    }}
                  >
                    {r.detectedLang}
                  </Box>
                )}
              </AspectRatio>
              <CardContent sx={{ p: 1 }}>
                <Typography level="body-sm" noWrap title={r.title} sx={{ fontWeight: 600 }}>
                  {r.title}
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography level="body-xs" noWrap>{r.channel}</Typography>
                  <Typography level="body-xs">{formatDuration(r.durationSec)}</Typography>
                </Stack>
                {onEnqueue && (
                  <Button
                    size="sm"
                    variant="soft"
                    color="primary"
                    sx={{ mt: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnqueue({
                        videoId: r.videoId,
                        title: r.title,
                        thumbnail: r.thumbnail,
                        durationSec: r.durationSec,
                      });
                    }}
                  >
                    ＋ 加入歌單
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {!loading && !err && results.length === 0 && q && (
        <Typography level="body-sm" sx={{ color: "rgba(255,255,255,0.5)" }}>
          沒有結果。試試別的關鍵字。
        </Typography>
      )}
    </Sheet>
  );
}
