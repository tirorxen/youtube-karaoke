/**
 * 自動偵測剪貼簿是否為 YT URL — 若是顯示橫幅讓使用者一鍵載入。
 *
 * 觸發時機：
 *   - mount 時讀一次
 *   - 視窗 focus 時讀一次（從 YT 切回來就觸發）
 *
 * 注意：`navigator.clipboard.readText` 在 Firefox 需使用者授權；
 * 失敗時 silent fallback（橫幅不出現）。
 */
import { Button, Sheet, Stack, Typography } from "@mui/joy";
import { useEffect, useState } from "react";

import { isYouTubeUrl, parseYouTubeId } from "../youtube/parseId";

interface Props {
  onLoad: (url: string) => void;
  /** 已經是這個 videoId 的話不再彈，避免重複載入 */
  currentVideoId: string | null;
}

export function ClipboardDetector({ onLoad, currentVideoId }: Props) {
  const [detected, setDetected] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!alive) return;
        if (!isYouTubeUrl(text)) return;
        const id = parseYouTubeId(text)!;
        if (id === currentVideoId) return;
        if (dismissed.has(id)) return;
        setDetected(text.trim());
      } catch {
        /* permission denied; silent */
      }
    };
    probe();
    const onFocus = () => probe();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [currentVideoId, dismissed]);

  if (!detected) return null;

  const id = parseYouTubeId(detected)!;
  return (
    <Sheet
      variant="soft"
      color="primary"
      sx={{
        px: 2,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 2,
        borderBottom: "1px solid var(--joy-palette-primary-300)",
      }}
    >
      <Typography level="body-sm" sx={{ flex: 1 }}>
        📋 偵測到剪貼簿有 YouTube 連結：<code>{detected.slice(0, 60)}</code>
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button
          size="sm"
          onClick={() => {
            onLoad(detected);
            setDetected(null);
          }}
        >
          載入
        </Button>
        <Button
          size="sm"
          variant="plain"
          color="neutral"
          onClick={() => {
            setDismissed((s) => new Set(s).add(id));
            setDetected(null);
          }}
        >
          略過
        </Button>
      </Stack>
    </Sheet>
  );
}
