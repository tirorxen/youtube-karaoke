/**
 * 導唱值一鍵預設按鈕。
 *
 * 5 個 chip 取代 slider — 唱歌時離電腦遠，一鍵切換比拖滑桿快。
 *
 *   [純伴奏][微導唱][半導唱][半伴奏][原唱]
 *      0%    30%    50%    70%    100%
 */
import { Button, Stack, Typography } from "@mui/joy";

const PRESETS: ReadonlyArray<{ label: string; value: number; hint: string }> = [
  { label: "純伴奏", value: 0, hint: "完全去人聲" },
  { label: "微導唱", value: 30, hint: "聽得到一點人聲做提示" },
  { label: "半導唱", value: 50, hint: "原音與伴奏各半" },
  { label: "半伴奏", value: 70, hint: "原音多一點" },
  { label: "原唱", value: 100, hint: "完整原曲（不去人聲）" },
];

interface Props {
  value: number;                           // 0..100
  onChange: (value: number) => void;
}

/** 找出與 value 最接近的 preset；給「選中高亮」邏輯用 */
function nearestPreset(value: number): number {
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < PRESETS.length; i++) {
    const diff = Math.abs(PRESETS[i].value - value);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

export function GuideVocalChips({ value, onChange }: Props) {
  const activeIdx = nearestPreset(value);
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", justifyContent: "center" }}>
      {PRESETS.map((preset, idx) => {
        const isActive = idx === activeIdx;
        return (
          <Button
            key={preset.value}
            variant={isActive ? "solid" : "soft"}
            color={isActive ? "warning" : "neutral"}
            size="lg"
            onClick={() => onChange(preset.value)}
            title={preset.hint}
            sx={{
              minWidth: 96,
              flexDirection: "column",
              py: 1,
              transform: isActive ? "scale(1.05)" : "none",
              transition: "transform 150ms",
            }}
          >
            <Typography level="title-md" sx={{ color: "inherit", lineHeight: 1.1 }}>
              {preset.label}
            </Typography>
            <Typography level="body-xs" sx={{ color: "inherit", opacity: 0.85 }}>
              {preset.value}%
            </Typography>
          </Button>
        );
      })}
    </Stack>
  );
}
