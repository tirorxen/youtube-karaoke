/**
 * 「📱 手機遙控」資訊視窗 — 顯示同網域手機要開的網址 + QR code。
 *
 * 網址來自 backend /api/remote/info（列本機所有區網 IPv4）。
 * QR 用線上服務 api.qrserver.com 產（只把私有 IP 傳出去，風險極低）；
 * 連不到網路就只顯示文字網址（一樣可手動輸入）。
 */
import {
  Box, Modal, ModalClose, ModalDialog, Sheet, Stack, Typography,
} from "@mui/joy";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RemoteInfoDialog({ open, onClose }: Props) {
  const [urls, setUrls] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    fetch("/api/remote/info")
      .then((r) => r.json())
      .then((d) => setUrls(Array.isArray(d.urls) ? d.urls : []))
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [open]);

  const primary = urls[0];

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ maxWidth: 460 }}>
        <ModalClose />
        <Typography level="h4">📱 手機遙控</Typography>
        <Typography level="body-sm" sx={{ mb: 1 }}>
          手機連到<b>同一個 WiFi</b>，用瀏覽器開下面網址（或掃 QR），就能查看歌單、點歌、切歌、插播。
        </Typography>

        {err && (
          <Typography color="danger" level="body-sm">取得網址失敗：{err}</Typography>
        )}

        {primary ? (
          <Stack spacing={2} alignItems="center">
            <Box
              component="img"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(primary)}`}
              alt="QR"
              sx={{ width: 220, height: 220, borderRadius: 8, background: "#fff", p: 1 }}
            />
            <Stack spacing={0.5} sx={{ width: "100%" }}>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>可用網址（擇一）：</Typography>
              {urls.map((u) => (
                <Sheet
                  key={u}
                  variant="soft"
                  sx={{ px: 1.5, py: 1, borderRadius: 6, fontFamily: "monospace", fontSize: 15, userSelect: "all", wordBreak: "break-all" }}
                >
                  {u}
                </Sheet>
              ))}
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              連不上的話：Windows 防火牆可能擋了 5174 埠，第一次跑請允許「私人網路」存取。
            </Typography>
          </Stack>
        ) : !err ? (
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>讀取網址中…（或這台電腦沒連到網路）</Typography>
        ) : null}
      </ModalDialog>
    </Modal>
  );
}
