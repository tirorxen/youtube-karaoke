/**
 * 字幕語言挑選 —「🔁 重挑字幕」按鈕 + 下拉。
 *
 * backend 自動挑「原文 manual」優先，但有時候會抓錯（例如某影片人工字幕只有粉絲翻譯版、
 * 或自動字幕的原文 track 比 manual 還準）。讓使用者手動切。
 */
import {
  Chip, Dropdown, ListDivider, ListItemContent, ListItemDecorator,
  Menu, MenuButton, MenuItem, Typography,
} from "@mui/joy";

import type { CaptionTrack } from "../youtube/backendClient";

interface Props {
  tracks: CaptionTrack[];
  currentLang: string | null;
  onPick: (track: CaptionTrack) => void;
  /** 用歌名重抓 lrclib 同步歌詞（YT CC 對不準時用） */
  onForceLrclib?: () => void;
}

export function CaptionPicker({ tracks, currentLang, onPick, onForceLrclib }: Props) {
  // 即使沒 tracks 也要顯示，因為還有「🎵 從歌詞庫重抓」這個 option
  if ((!tracks || tracks.length === 0) && !onForceLrclib) return null;

  // 分組：manual 在前、auto 在後（manual 通常逐字 timing 準）
  const manual = tracks.filter((t) => t.source === "manual");
  const auto = tracks.filter((t) => t.source === "auto");
  const current = tracks.find((t) => t.lang === currentLang) ?? null;

  return (
    <Dropdown>
      <MenuButton
        size="sm" variant="outlined" color="neutral"
        sx={{ flexShrink: 0 }}
        title="字幕抓錯了？換一個 track 試試"
      >
        🔁 字幕
        {current && (
          <Chip size="sm" variant="soft"
            color={current.source === "manual" ? "success" : "warning"}
            sx={{ ml: 0.75, fontSize: 11 }}
          >
            {current.lang}{current.source === "auto" ? " · auto" : ""}
          </Chip>
        )}
      </MenuButton>
      <Menu size="sm" sx={{ maxHeight: 380, overflow: "auto", minWidth: 220 }}>
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.7 }}>
          人工上傳（逐字 timing 通常較好）
        </Typography>
        {manual.length === 0 && (
          <MenuItem disabled><ListItemContent>（無）</ListItemContent></MenuItem>
        )}
        {manual.map((t) => (
          <MenuItem
            key={`m-${t.lang}`}
            selected={t.lang === currentLang}
            onClick={() => onPick(t)}
          >
            <ListItemDecorator>{t.lang === currentLang ? "✓" : ""}</ListItemDecorator>
            <ListItemContent>
              {t.lang}{" "}
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>manual</Typography>
            </ListItemContent>
          </MenuItem>
        ))}
        <ListDivider />
        <Typography level="body-xs" sx={{ px: 1.5, py: 0.5, opacity: 0.7 }}>
          YouTube 自動（同語言 ASR；非原文版本通常是亂翻譯）
        </Typography>
        {auto.map((t) => (
          <MenuItem
            key={`a-${t.lang}`}
            selected={t.lang === currentLang}
            onClick={() => onPick(t)}
          >
            <ListItemDecorator>{t.lang === currentLang ? "✓" : ""}</ListItemDecorator>
            <ListItemContent>
              {t.lang}{" "}
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>auto</Typography>
            </ListItemContent>
          </MenuItem>
        ))}
        {onForceLrclib && (
          <>
            <ListDivider />
            <MenuItem onClick={onForceLrclib}>
              <ListItemDecorator>🎵</ListItemDecorator>
              <ListItemContent>
                <b>從歌詞庫重抓（lrclib.net）</b>
                <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                  用歌曲名搜尋同步 LRC（YT CC 對不準時最後一招）
                </Typography>
              </ListItemContent>
            </MenuItem>
          </>
        )}
      </Menu>
    </Dropdown>
  );
}
