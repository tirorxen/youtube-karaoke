import { Button, Sheet, Stack, Typography } from "@mui/joy";
import { useRef } from "react";

import { InstallPwaPrompt } from "./InstallPwaPrompt";
import { isYouTubeUrl } from "../youtube/parseId";

interface Props {
  onOpenLocal: (file: File, sidecar: File | null) => void;
  onOpenYouTubeUrl: (url: string) => void;
  onOpenUrlDialog: () => void;
  onOpenSearch: () => void;
  onOpenQueue: () => void;
  queueCount: number;
  onOpenRemote: () => void;
  onToggleStage: () => void;
  onOpenSpotify: () => void;
  onToggleMic: () => void;
  micActive: boolean;
}

const VIDEO_AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".mp4", ".webm", ".mkv"];

export function Toolbar({
  onOpenLocal,
  onOpenYouTubeUrl,
  onOpenUrlDialog,
  onOpenSearch,
  onOpenQueue,
  queueCount,
  onOpenRemote,
  onToggleStage,
  onOpenSpotify,
  onToggleMic,
  micActive,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** 一鍵讀剪貼簿載入；失敗（權限拒絕）退回 Dialog 讓使用者手動貼 */
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && isYouTubeUrl(text)) {
        onOpenYouTubeUrl(text.trim());
        return;
      }
    } catch {
      /* fall through to dialog */
    }
    onOpenUrlDialog();
  };

  return (
    <Sheet
      variant="solid"
      color="primary"
      sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1.5 }}
    >
      <Typography level="title-md" sx={{ color: "#fff", mr: 2 }}>
        🎤 YouTube 卡拉 OK
      </Typography>

      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_AUDIO_EXTS.join(",") + ",.lrc,.srt,.vtt"}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          const media = files.find((f) =>
            VIDEO_AUDIO_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext))
          );
          const sidecar =
            files.find((f) => /\.(lrc|srt|vtt)$/i.test(f.name)) ?? null;
          if (media) onOpenLocal(media, sidecar);
          e.target.value = "";
        }}
      />

      <Button size="sm" onClick={() => inputRef.current?.click()}>
        📂 開啟音檔
      </Button>

      <Button size="sm" variant="solid" color="success" onClick={onOpenSearch}>
        🔍 搜尋 YT
      </Button>

      <Button size="sm" variant="solid" color="warning" onClick={onOpenQueue}>
        📋 歌單{queueCount > 0 ? `（${queueCount}）` : ""}
      </Button>

      <Button size="sm" variant="soft" color="success" onClick={onOpenSpotify} title="從 Spotify 公開歌單批次匯入到歌單">
        🎶 Spotify 匯入
      </Button>

      <Button size="sm" variant="solid" color="success" onClick={pasteFromClipboard}>
        📋 貼上 URL
      </Button>

      <Button size="sm" onClick={onOpenUrlDialog}>
        🔗 YouTube URL
      </Button>

      <Button
        size="sm"
        color={micActive ? "warning" : "neutral"}
        onClick={onToggleMic}
      >
        {micActive ? "🎙 麥克風開啟中" : "🎙 啟用麥克風"}
      </Button>

      <Button size="sm" variant="soft" color="neutral" onClick={onOpenRemote}>
        📱 手機遙控
      </Button>

      <Button size="sm" variant="soft" color="neutral" onClick={onToggleStage} title="舞台模式（藏 UI、影片+字幕填滿）">
        📺 舞台
      </Button>

      <InstallPwaPrompt />

      <Stack direction="row" spacing={1} sx={{ ml: "auto" }} />
    </Sheet>
  );
}
