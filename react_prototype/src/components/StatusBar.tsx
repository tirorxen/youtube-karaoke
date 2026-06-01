/**
 * 頂部狀態列：歌名 + demucs 狀態徽章。
 *
 * demucs 狀態：
 *   - "off"：尚未啟動高品質模式
 *   - "pending"：背景處理中（顯示百分比 + ETA）
 *   - "ready"：已完成、無人聲版已 swap 進來
 *   - "failed"：失敗
 */
import { Chip, LinearProgress, Sheet, Stack, Typography } from "@mui/joy";

import type { DemucsProgress } from "../youtube/backendClient";

export type HqState = "off" | "pending" | "ready" | "failed";

interface Props {
  title: string | null;
  hqState: HqState;
  hqProgress: DemucsProgress | null;
}

export function StatusBar({ title, hqState, hqProgress }: Props) {
  return (
    <Sheet
      variant="soft"
      sx={{
        px: 2, py: 1,
        display: "flex", alignItems: "center", gap: 2,
        borderBottom: "1px solid var(--joy-palette-divider)",
        flexWrap: "wrap",
      }}
    >
      <Typography level="title-md" sx={{ flex: 1, minWidth: 0 }} noWrap>
        🎤 {title ?? "—"}
      </Typography>

      <HqBadge state={hqState} progress={hqProgress} />
    </Sheet>
  );
}

function HqBadge({ state, progress }: { state: HqState; progress: DemucsProgress | null }) {
  if (state === "off") {
    return <Chip variant="outlined" size="sm">🎵 三頻段去人聲</Chip>;
  }
  if (state === "pending") {
    const pct = progress?.percent ?? 0;
    const eta = progress?.etaSec;
    const etaStr = eta !== undefined
      ? ` · 剩 ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, "0")}`
      : "";
    return (
      <Stack direction="column" alignItems="flex-end" spacing={0.5} sx={{ minWidth: 220 }}>
        <Chip variant="solid" color="warning" size="sm">
          🤖 demucs 處理中 {pct.toFixed(0)}%{etaStr}
        </Chip>
        <LinearProgress
          determinate
          value={pct}
          color="warning"
          sx={{ height: 4, width: "100%" }}
        />
      </Stack>
    );
  }
  if (state === "ready") {
    return <Chip variant="solid" color="success" size="sm">✓ 高品質已就緒（導唱可調）</Chip>;
  }
  return <Chip variant="solid" color="danger" size="sm">⚠️ 高品質失敗</Chip>;
}
