/**
 * Spotify 公開歌單匯入：
 *   1) 貼入 spotify playlist URL（https://open.spotify.com/playlist/...）
 *   2) backend 抓歌單 → 顯示 checkbox 列表（預設前 30 勾選）
 *   3) 按「匯入」→ backend 平行對每首跑 YT search → 進度顯示
 *   4) 結果預覽，點「全部加入歌單」批次 enqueue
 *
 * cap 30 首是為了不被 YT throttle + 視覺好處理。要更多分批跑。
 */
import {
  Box, Button, Checkbox, Chip, CircularProgress, Input, LinearProgress,
  Modal, ModalClose, ModalDialog, Sheet, Stack, Typography,
} from "@mui/joy";
import { useState } from "react";

import { useQueue } from "../queue/store";
import {
  fetchSpotifyPlaylist, matchSpotifyToYoutube,
  type SpotifyMatchResult, type SpotifyTrack,
} from "../youtube/backendClient";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "input" | "loadingPlaylist" | "picking" | "matching" | "done";

const MAX_PICK = 30;

export function SpotifyImport({ open, onClose }: Props) {
  const enqueue = useQueue((s) => s.enqueue);

  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<SpotifyMatchResult[]>([]);

  const reset = () => {
    setPhase("input"); setUrl(""); setError(null);
    setTracks([]); setSelected(new Set()); setResults([]);
  };
  const close = () => { reset(); onClose(); };

  const doFetchPlaylist = async () => {
    if (!url.trim()) return;
    setPhase("loadingPlaylist"); setError(null);
    try {
      const d = await fetchSpotifyPlaylist(url.trim());
      setTracks(d.tracks);
      // 預設勾前 30 首
      setSelected(new Set(d.tracks.slice(0, MAX_PICK).map((_, i) => i)));
      setPhase("picking");
    } catch (e) {
      setError(String((e as Error).message));
      setPhase("input");
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < MAX_PICK) next.add(i);
      return next;
    });
  };
  const selectAll = () => {
    setSelected(new Set(tracks.slice(0, MAX_PICK).map((_, i) => i)));
  };
  const selectNone = () => setSelected(new Set());

  const doMatch = async () => {
    const picked = [...selected].sort((a, b) => a - b).map((i) => tracks[i]).filter(Boolean);
    if (picked.length === 0) return;
    setPhase("matching"); setError(null);
    try {
      const d = await matchSpotifyToYoutube(picked);
      setResults(d.results);
      setPhase("done");
    } catch (e) {
      setError(String((e as Error).message));
      setPhase("picking");
    }
  };

  const enqueueAll = () => {
    let added = 0;
    for (const r of results) {
      if (r.videoId) {
        enqueue({ videoId: r.videoId, title: r.title ?? r.spotifyTitle, thumbnail: r.thumbnail ?? null });
        added++;
      }
    }
    window.alert(`已加入歌單 ${added} 首${added < results.length ? `（${results.length - added} 首沒找到 YT 對應）` : ""}`);
    close();
  };

  return (
    <Modal open={open} onClose={close}>
      <ModalDialog sx={{ maxWidth: 720, width: "92vw", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ModalClose onClick={close} />
        <Typography level="h4">🎶 Spotify 歌單匯入</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          貼入「分享連結」（公開歌單）→ 勾選想唱的 → 自動到 YouTube 找 lyrics 影片加入歌單。
          一次最多 {MAX_PICK} 首。
        </Typography>

        {error && (
          <Sheet variant="soft" color="danger" sx={{ p: 1.5, borderRadius: 6, mb: 1, whiteSpace: "pre-wrap" }}>
            <Typography level="body-sm">{error}</Typography>
          </Sheet>
        )}

        {phase === "input" || phase === "loadingPlaylist" ? (
          <Stack spacing={1.5}>
            <Input
              autoFocus value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doFetchPlaylist(); }}
              placeholder="https://open.spotify.com/playlist/..."
              disabled={phase === "loadingPlaylist"}
            />
            <Stack direction="row" spacing={1}>
              <Button
                disabled={phase === "loadingPlaylist" || !url.trim()}
                onClick={doFetchPlaylist}
                startDecorator={phase === "loadingPlaylist" ? <CircularProgress size="sm" /> : null}
              >
                {phase === "loadingPlaylist" ? "抓取中…" : "抓取歌單"}
              </Button>
              <Button variant="plain" onClick={close}>取消</Button>
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              ※ 不需要 Spotify credentials —— 直接爬公開歌單的 embed 頁面。
              歌單必須是「公開」狀態（Spotify app → ⋯ → 分享 → 「Anyone with the link」）。
            </Typography>
          </Stack>
        ) : null}

        {phase === "picking" && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
              <Typography level="body-sm">
                共 {tracks.length} 首 · 已選 <b>{selected.size}</b> / {MAX_PICK}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="sm" variant="plain" onClick={selectAll}>全選前 {MAX_PICK}</Button>
              <Button size="sm" variant="plain" onClick={selectNone}>全不選</Button>
            </Stack>
            <Box sx={{ flex: 1, overflowY: "auto", mb: 1.5 }}>
              {tracks.map((t, i) => {
                const checked = selected.has(i);
                const overLimit = !checked && selected.size >= MAX_PICK;
                return (
                  <Sheet
                    key={i} variant="soft"
                    sx={{
                      display: "flex", alignItems: "center", gap: 1, p: 1, mb: 0.5, borderRadius: 6,
                      opacity: overLimit ? 0.4 : 1, cursor: overLimit ? "not-allowed" : "pointer",
                    }}
                    onClick={() => !overLimit && toggle(i)}
                  >
                    <Checkbox checked={checked} disabled={overLimit} onChange={() => toggle(i)} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography level="body-sm" noWrap>{t.title}</Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                        {t.artists.join(", ")} · {Math.floor(t.durationSec / 60)}:{String(t.durationSec % 60).padStart(2, "0")}
                      </Typography>
                    </Box>
                  </Sheet>
                );
              })}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button onClick={doMatch} disabled={selected.size === 0} variant="solid" color="primary">
                🔍 到 YT 找這 {selected.size} 首的 lyrics 影片
              </Button>
              <Button variant="plain" onClick={() => setPhase("input")}>← 換歌單</Button>
            </Stack>
          </>
        )}

        {phase === "matching" && (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size="lg" />
            <Typography>正在到 YouTube 配對 {selected.size} 首…</Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              每首約 5-10 秒（同時跑 3 個）。30 首大概 50-100 秒。
            </Typography>
            <LinearProgress determinate={false} sx={{ width: 280 }} />
          </Stack>
        )}

        {phase === "done" && (
          <>
            <Typography level="body-sm" sx={{ mb: 1 }}>
              配對完成。{results.filter((r) => r.videoId).length} / {results.length} 首找到 YT 對應：
            </Typography>
            <Box sx={{ flex: 1, overflowY: "auto", mb: 1.5 }}>
              {results.map((r, i) => (
                <Sheet
                  key={i} variant="soft"
                  sx={{
                    display: "flex", gap: 1, alignItems: "center", p: 1, mb: 0.5, borderRadius: 6,
                    opacity: r.videoId ? 1 : 0.5,
                  }}
                >
                  {r.thumbnail ? (
                    <img src={r.thumbnail} alt="" style={{ width: 80, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                  ) : (
                    <Box sx={{ width: 80, height: 45, borderRadius: 4, background: "var(--joy-palette-neutral-700)" }} />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="body-sm" noWrap>{r.title ?? r.spotifyTitle}</Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                        {r.spotifyTitle}
                      </Typography>
                      {r.hasCaptions && <Chip size="sm" color="success" variant="soft">CC</Chip>}
                      {!r.videoId && <Chip size="sm" color="danger" variant="soft">未找到</Chip>}
                    </Stack>
                  </Box>
                </Sheet>
              ))}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button color="primary" variant="solid" onClick={enqueueAll}>
                ＋ 全部加入歌單（{results.filter((r) => r.videoId).length} 首）
              </Button>
              <Button variant="plain" onClick={() => setPhase("picking")}>← 重選</Button>
            </Stack>
          </>
        )}
      </ModalDialog>
    </Modal>
  );
}
