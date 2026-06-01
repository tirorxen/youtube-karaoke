/**
 * 美化的 YouTube URL 輸入 Modal — 取代 `window.prompt`。
 *
 * 功能：
 *   - mount 時自動聚焦
 *   - 自動嘗試從剪貼簿讀 URL（若可讀且是 YT URL 自動填入）
 *   - 即時驗證 URL 合法性，按鈕只在合法時亮起
 *   - Enter 鍵送出
 */
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Stack,
} from "@mui/joy";
import { useEffect, useRef, useState } from "react";

import { isYouTubeUrl } from "../youtube/parseId";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string) => void;
}

export function UrlInputDialog({ open, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue("");
    // 嘗試自動從剪貼簿讀 — 失敗（權限拒絕）就算了，使用者可手動貼
    (async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (isYouTubeUrl(text)) setValue(text.trim());
      } catch {
        /* ignore */
      }
    })();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const valid = isYouTubeUrl(value);

  const submit = () => {
    if (!valid) return;
    onSubmit(value.trim());
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ minWidth: 480 }}>
        <DialogTitle>🔗 貼上 YouTube 連結</DialogTitle>
        <DialogContent>
          {value && !valid ? "看起來不像 YouTube 連結 — 應該是 https://www.youtube.com/watch?v=… 或 https://youtu.be/…" : "支援 youtube.com / youtu.be / 純 11 字元 video ID"}
        </DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <FormControl>
            <FormLabel>YouTube URL</FormLabel>
            <Input
              slotProps={{ input: { ref: inputRef } }}
              value={value}
              placeholder="https://www.youtube.com/watch?v=..."
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") onClose();
              }}
              autoFocus
            />
          </FormControl>
        </Stack>
        <DialogActions>
          <Button variant="solid" disabled={!valid} onClick={submit}>
            載入
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose}>
            取消
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
