/**
 * 設定 dock — 全部 KaraokeSettings 欄位以 slider/select 呈現。
 *
 * 對應 Android `SettingsFragment.kt` 與 Python `settings_panel.py`。
 */
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Option,
  Select,
  Sheet,
  Slider,
  Stack,
  Switch,
  Typography,
} from "@mui/joy";
import { useEffect, useState } from "react";

import type { DemucsModel, GenderPreset, MicSource } from "../settings/KaraokeSettings";
import { useSettings } from "../settings/store";

export function SettingsPanel() {
  const { settings, update } = useSettings();

  return (
    <Sheet variant="outlined" sx={{ p: 2, height: "100%", overflowY: "auto" }}>
      <Stack spacing={3}>
        <SectionHeader title="音訊處理" />
        <SliderRow
          label="導唱值"
          value={settings.guideVocalPercent}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => update({ guideVocalPercent: v })}
        />
        <SliderRow
          label="升降 KEY"
          value={settings.pitchSemitones}
          min={-12}
          max={12}
          suffix=" 半音"
          onChange={(v) => update({ pitchSemitones: v })}
        />
        <Typography level="body-xs" sx={{ opacity: 0.7, mt: -1, mb: 1 }}>
          即時變調（雙讀頭 delay-line）。純音樂上 ±5 半音內最自然；超過會有輕微 warble。
        </Typography>
        <FormControl>
          <FormLabel>性別預設</FormLabel>
          <Select
            value={settings.genderPreset}
            onChange={(_, value) =>
              update({ genderPreset: (value ?? "OFF") as GenderPreset })
            }
          >
            <Option value="OFF">關閉</Option>
            <Option value="MALE_TO_FEMALE">男 → 女 (+5)</Option>
            <Option value="FEMALE_TO_MALE">女 → 男 (-5)</Option>
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel>Buffer size (frames)</FormLabel>
          <Select
            value={settings.bufferSize}
            onChange={(_, value) =>
              update({ bufferSize: (value ?? 256) as 128 | 256 | 512 | 1024 })
            }
          >
            {[128, 256, 512, 1024].map((n) => (
              <Option key={n} value={n}>
                {n}
              </Option>
            ))}
          </Select>
        </FormControl>

        <Box
          sx={{
            border: "1px solid var(--joy-palette-warning-300)",
            borderRadius: 8,
            p: 1.5,
            background: "var(--joy-palette-warning-50)",
            color: "var(--joy-palette-warning-900)",
          }}
        >
          <Box>
            <FormLabel sx={{ fontWeight: 700 }}>🤖 高品質去人聲（demucs ML）</FormLabel>
            <Typography level="body-xs" sx={{ mt: 0.5, mb: 1 }}>
              **改成播放畫面下方的「🤖 啟用高品質去人聲」按鈕。**
              播一首歌後再點，避免誤觸卡住。處理約 1-2 分鐘，cache 永久。
            </Typography>
            <FormControl sx={{ mt: 0.5 }}>
              <FormLabel>demucs 模型（預先選好）</FormLabel>
              <Select
                value={settings.demucsModel}
                onChange={(_, value) =>
                  update({ demucsModel: (value ?? "htdemucs") as DemucsModel })
                }
              >
                <Option value="htdemucs">htdemucs — 單一模型（推薦，CPU ~1-2 分鐘）</Option>
                <Option value="mdx_extra_q">mdx_extra_q — 4 模型集成（更穩，~4-8 分鐘）</Option>
                <Option value="htdemucs_ft">htdemucs_ft — fine-tuned（最佳品質，更慢）</Option>
              </Select>
              <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.7 }}>
                第一次跑會下載模型（80-300MB）。處理結果永久 cache。
              </Typography>
            </FormControl>
          </Box>
        </Box>

        <SectionHeader title="延遲補償" />
        <SliderRow
          label="字幕偏移"
          value={settings.subtitleOffsetMs}
          min={-1000}
          max={1000}
          step={10}
          suffix=" ms"
          onChange={(v) => update({ subtitleOffsetMs: v })}
        />
        <SliderRow
          label="Mic 對齊"
          value={settings.micAlignmentMs}
          min={0}
          max={500}
          step={5}
          suffix=" ms"
          onChange={(v) => update({ micAlignmentMs: v })}
        />
        <FormControl orientation="horizontal" sx={{ justifyContent: "space-between" }}>
          <FormLabel>新影片自動 re-run 去人聲</FormLabel>
          <Switch
            checked={settings.autoRerunVocalRemoval}
            onChange={(e) => update({ autoRerunVocalRemoval: e.target.checked })}
          />
        </FormControl>

        <SectionHeader title="麥克風" />
        <SliderRow
          label="Mic 音量"
          value={settings.micGainPercent}
          min={0}
          max={200}
          suffix="%"
          onChange={(v) => update({ micGainPercent: v })}
        />
        <FormControl>
          <FormLabel>Mic 來源（瀏覽器統一介面）</FormLabel>
          <Select
            value={settings.micSource}
            onChange={(_, value) =>
              update({ micSource: (value ?? "BUILTIN") as MicSource })
            }
          >
            <Option value="USB">USB</Option>
            <Option value="BLUETOOTH">Bluetooth</Option>
            <Option value="BUILTIN">內建</Option>
            <Option value="COMPANION">Companion App</Option>
          </Select>
        </FormControl>

        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          已校準延遲：{settings.measuredRoundTripMs >= 0 ? `${settings.measuredRoundTripMs} ms` : "尚未校準"}
        </Typography>

        <SectionHeader title="暫存檔" />
        <CacheSection />
      </Stack>
    </Sheet>
  );
}

/**
 * 暫存檔資訊 + 清除按鈕。**只在 dashboard 設定頁顯示**，手機遙控頁不會出現
 * （那邊純靜態，沒這個 component）→ 防呆，避免遠端誤觸把全家上百首 cache 清光。
 */
function CacheSection() {
  const [info, setInfo] = useState<{ mb: number; files: number; dir: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch("/api/cache/info");
      if (r.ok) setInfo(await r.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { refresh(); }, []);

  const onClear = async () => {
    if (!info) return;
    const msg = `要清除全部 ${info.files} 個暫存檔（${info.mb} MB）嗎？\n` +
                `清完之後重點同一首歌會重新下載 + 重跑 demucs。`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/cache/clear", { method: "POST" });
      const d = await r.json();
      if (d?.ok) {
        const mb = (d.cleared.bytes / 1024 / 1024).toFixed(1);
        window.alert(`已清除 ${d.cleared.files} 個檔案，釋出 ${mb} MB。`);
      } else {
        window.alert("清除失敗：" + (d?.error ?? "unknown"));
      }
      await refresh();
    } catch (e) {
      window.alert("清除失敗：" + String((e as Error).message));
    } finally { setBusy(false); }
  };

  return (
    <Stack spacing={1}>
      <Typography level="body-xs" sx={{ opacity: 0.7 }}>
        已下載音檔／視訊／demucs 結果，重點同一首歌可 instant 載入。
      </Typography>
      {info ? (
        <Typography level="body-sm">
          目前 <b>{info.files}</b> 個檔案，<b>{info.mb} MB</b>
        </Typography>
      ) : (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>讀取中…</Typography>
      )}
      <Stack direction="row" spacing={1}>
        <Button size="sm" variant="outlined" onClick={refresh}>重新整理</Button>
        <Button
          size="sm" variant="solid" color="danger"
          disabled={busy || !info || info.files === 0}
          onClick={onClear}
        >
          🗑 清除所有暫存檔
        </Button>
      </Stack>
      {info?.dir && (
        <Typography level="body-xs" sx={{ opacity: 0.5, fontFamily: "monospace", wordBreak: "break-all" }}>
          位置：{info.dir}
        </Typography>
      )}
    </Stack>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Typography level="title-md" sx={{ borderBottom: "1px solid #444", pb: 0.5 }}>
      {title}
    </Typography>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step = 1, suffix = "", onChange }: SliderRowProps) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        <Typography level="body-sm">{label}</Typography>
        <Typography level="body-sm">
          {value}
          {suffix}
        </Typography>
      </Stack>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </Box>
  );
}
