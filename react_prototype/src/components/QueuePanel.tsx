/**
 * 歌單面板（overlay）— 兩個分頁：
 *   - 🎵 待播：當前歌單，可重排/插播/移除
 *   - 📚 歷史：已存過的歌單 snapshots，可「追加 / 替換 / 改名 / 刪除」
 *
 * 「💾 儲存目前歌單」會把待播清單存成具名 snapshot，下次想唱同一套直接載入。
 * 對應 KTV 機台的「我的點唱清單」。
 */
import {
  Box, Button, Chip, IconButton, Input, Sheet, Stack, Typography,
} from "@mui/joy";
import { useState } from "react";

import { useQueue, type QueueHqStatus } from "../queue/store";
import { useQueueHistory } from "../queue/history";
import { usePlayedHistory } from "../played/store";

interface Props {
  onClose: () => void;
  /** 立即播放某首（會從歌單移除）。 */
  onPlayNow: (videoId: string) => void;
}

type Tab = "queue" | "history" | "played";

function StatusChip({ status }: { status: QueueHqStatus | undefined }) {
  if (status === "ready") return <Chip size="sm" color="success" variant="soft">✓ 已就緒</Chip>;
  if (status === "processing") return <Chip size="sm" color="warning" variant="soft">🤖 處理中</Chip>;
  if (status === "failed") return <Chip size="sm" color="danger" variant="soft">⚠ 失敗</Chip>;
  return <Chip size="sm" color="neutral" variant="outlined">待處理</Chip>;
}

export function QueuePanel({ onClose, onPlayNow }: Props) {
  const { items, prefetch, removeAt, moveUp, moveDown, clear, enqueue } = useQueue();
  const { snapshots, save, rename, remove: removeSnapshot } = useQueueHistory();
  const { items: playedItems, remove: removePlayed, clear: clearPlayed } = usePlayedHistory();
  const [tab, setTab] = useState<Tab>("queue");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const doSave = () => {
    if (items.length === 0) return;
    save(saveName, items);
    setSaveName("");
    setSaveDialogOpen(false);
    setTab("history");
  };

  const loadSnapshot = (id: string, mode: "append" | "replace") => {
    const snap = snapshots.find((x) => x.id === id);
    if (!snap) return;
    if (mode === "replace") clear();
    for (const it of snap.items) {
      enqueue({ videoId: it.videoId, title: it.title, thumbnail: it.thumbnail ?? null, durationSec: it.durationSec });
    }
    setTab("queue");
  };

  const commitRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) rename(id, trimmed);
    setRenameId(null);
    setRenameValue("");
  };

  return (
    <Sheet
      sx={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
        zIndex: 10000, display: "flex", flexDirection: "column",
        alignItems: "center", overflow: "auto", py: 4,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Sheet variant="outlined" sx={{ width: "100%", maxWidth: 720, borderRadius: 12, p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={0.5}>
            <Button
              size="sm"
              variant={tab === "queue" ? "solid" : "plain"}
              color={tab === "queue" ? "primary" : "neutral"}
              onClick={() => setTab("queue")}
            >
              🎵 待播（{items.length}）
            </Button>
            <Button
              size="sm"
              variant={tab === "history" ? "solid" : "plain"}
              color={tab === "history" ? "primary" : "neutral"}
              onClick={() => setTab("history")}
            >
              📚 歷史（{snapshots.length}）
            </Button>
            <Button
              size="sm"
              variant={tab === "played" ? "solid" : "plain"}
              color={tab === "played" ? "primary" : "neutral"}
              onClick={() => setTab("played")}
            >
              🔁 再唱一次（{playedItems.length}）
            </Button>
          </Stack>
          <Button size="sm" variant="plain" onClick={onClose}>✕ 關閉</Button>
        </Stack>

        {tab === "queue" && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <Button
                size="sm" variant="soft" color="primary"
                disabled={items.length === 0}
                onClick={() => { setSaveName(""); setSaveDialogOpen(true); }}
              >
                💾 儲存目前歌單
              </Button>
              {items.length > 0 && (
                <Button size="sm" variant="outlined" color="danger" onClick={() => clear()}>
                  清空
                </Button>
              )}
            </Stack>

            {saveDialogOpen && (
              <Sheet variant="soft" sx={{ p: 1.5, borderRadius: 8, mb: 1.5 }}>
                <Typography level="body-sm" sx={{ mb: 0.5 }}>歌單名稱（留空＝自動日期時間）</Typography>
                <Stack direction="row" spacing={1}>
                  <Input
                    size="sm" autoFocus value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") doSave(); if (e.key === "Escape") setSaveDialogOpen(false); }}
                    placeholder="例：週五朋友聚會"
                    sx={{ flex: 1 }}
                  />
                  <Button size="sm" onClick={doSave}>儲存</Button>
                  <Button size="sm" variant="plain" onClick={() => setSaveDialogOpen(false)}>取消</Button>
                </Stack>
              </Sheet>
            )}

            {items.length === 0 ? (
              <Stack alignItems="center" spacing={1} sx={{ py: 4, opacity: 0.7 }}>
                <Typography level="body-md">歌單是空的</Typography>
                <Typography level="body-xs">
                  在「🔍 搜尋 YT」或「最近播放」每張卡片上按「＋ 加入歌單」
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1}>
                {items.map((item, i) => (
                  <Sheet
                    key={item.videoId}
                    variant="soft"
                    sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1, borderRadius: 8 }}
                  >
                    <Typography level="body-sm" sx={{ width: 22, textAlign: "center", opacity: 0.6 }}>
                      {i + 1}
                    </Typography>
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ width: 72, height: 40, borderRadius: 4, background: "var(--joy-palette-primary-700)", flexShrink: 0 }} />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography level="body-sm" noWrap title={item.title}>{item.title}</Typography>
                      <StatusChip status={prefetch[item.videoId]} />
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <IconButton size="sm" variant="plain" disabled={i === 0} onClick={() => moveUp(i)} title="上移">▲</IconButton>
                      <IconButton size="sm" variant="plain" disabled={i === items.length - 1} onClick={() => moveDown(i)} title="下移">▼</IconButton>
                      <IconButton
                        size="sm" variant="solid" color="primary" title="立即播放此首"
                        onClick={() => { removeAt(i); onPlayNow(item.videoId); onClose(); }}
                      >▶</IconButton>
                      <IconButton size="sm" variant="plain" color="danger" onClick={() => removeAt(i)} title="移除">✕</IconButton>
                    </Stack>
                  </Sheet>
                ))}
              </Stack>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {snapshots.length === 0 ? (
              <Stack alignItems="center" spacing={1} sx={{ py: 4, opacity: 0.7 }}>
                <Typography level="body-md">尚未儲存過歌單</Typography>
                <Typography level="body-xs">
                  回到「🎵 待播」加幾首歌，按「💾 儲存目前歌單」就會存在這
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1}>
                {snapshots.map((snap) => (
                  <Sheet
                    key={snap.id}
                    variant="soft"
                    sx={{ p: 1.5, borderRadius: 8 }}
                  >
                    {renameId === snap.id ? (
                      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                        <Input
                          size="sm" autoFocus value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(snap.id);
                            if (e.key === "Escape") { setRenameId(null); setRenameValue(""); }
                          }}
                          sx={{ flex: 1 }}
                        />
                        <Button size="sm" onClick={() => commitRename(snap.id)}>確定</Button>
                        <Button size="sm" variant="plain" onClick={() => { setRenameId(null); setRenameValue(""); }}>取消</Button>
                      </Stack>
                    ) : (
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography level="title-sm" noWrap title={snap.name}>{snap.name}</Typography>
                          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                            {snap.items.length} 首 · {new Date(snap.savedTs).toLocaleString("zh-TW", { hour12: false })}
                          </Typography>
                        </Box>
                        <IconButton
                          size="sm" variant="plain"
                          onClick={() => { setRenameId(snap.id); setRenameValue(snap.name); }}
                          title="改名"
                        >✏</IconButton>
                      </Stack>
                    )}
                    <Stack direction="row" spacing={0.5} sx={{ overflowX: "auto", mb: 1, "& > *": { flexShrink: 0 } }}>
                      {snap.items.slice(0, 6).map((it, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            width: 56, height: 32, borderRadius: 4, overflow: "hidden",
                            background: "var(--joy-palette-neutral-700)", flexShrink: 0,
                          }}
                        >
                          {it.thumbnail && <img src={it.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                        </Box>
                      ))}
                      {snap.items.length > 6 && (
                        <Box sx={{ display: "flex", alignItems: "center", fontSize: 12, opacity: 0.7, px: 1 }}>
                          +{snap.items.length - 6}
                        </Box>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button size="sm" variant="solid" color="primary" onClick={() => loadSnapshot(snap.id, "append")}>
                        ＋ 追加
                      </Button>
                      <Button size="sm" variant="outlined" color="warning" onClick={() => loadSnapshot(snap.id, "replace")}>
                        ↻ 替換
                      </Button>
                      <Box sx={{ flex: 1 }} />
                      <Button size="sm" variant="plain" color="danger" onClick={() => removeSnapshot(snap.id)}>
                        ✕ 刪除
                      </Button>
                    </Stack>
                  </Sheet>
                ))}
              </Stack>
            )}
          </>
        )}

        {tab === "played" && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
              <Button
                size="sm" variant="solid" color="primary"
                disabled={playedItems.length === 0}
                onClick={() => {
                  for (const it of playedItems) {
                    enqueue({ videoId: it.videoId, title: it.title, thumbnail: it.thumbnail ?? null, durationSec: it.durationSec });
                  }
                  setTab("queue");
                }}
              >
                📥 全部加入歌單（{playedItems.length}）
              </Button>
              <Button
                size="sm" variant="outlined" color="primary"
                disabled={playedItems.length === 0}
                onClick={() => {
                  for (const it of playedItems.slice(0, 10)) {
                    enqueue({ videoId: it.videoId, title: it.title, thumbnail: it.thumbnail ?? null, durationSec: it.durationSec });
                  }
                  setTab("queue");
                }}
              >
                📥 最近 10 首
              </Button>
              <Box sx={{ flex: 1 }} />
              {playedItems.length > 0 && (
                <Button size="sm" variant="plain" color="danger"
                  onClick={() => { if (window.confirm(`要清空全部 ${playedItems.length} 首已唱記錄？`)) clearPlayed(); }}>
                  清空
                </Button>
              )}
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.6, mb: 1.5 }}>
              自動記錄你唱過的所有歌（永久保存）；按上面一鍵全部加入歌單，或單獨加入／立即播放。
            </Typography>

            {playedItems.length === 0 ? (
              <Stack alignItems="center" spacing={1} sx={{ py: 4, opacity: 0.7 }}>
                <Typography level="body-md">還沒有唱過任何歌</Typography>
                <Typography level="body-xs">每點一首新歌就會自動記錄，之後從這裡一鍵重唱</Typography>
              </Stack>
            ) : (
              <Stack spacing={1}>
                {playedItems.map((it) => (
                  <Sheet
                    key={it.videoId}
                    variant="soft"
                    sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1, borderRadius: 8 }}
                  >
                    {it.thumbnail ? (
                      <img src={it.thumbnail} alt="" style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ width: 72, height: 40, borderRadius: 4, background: "var(--joy-palette-primary-700)", flexShrink: 0 }} />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography level="body-sm" noWrap title={it.title}>{it.title}</Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        唱過 {it.playCount} 次 · {new Date(it.lastPlayedTs).toLocaleString("zh-TW", { hour12: false })}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <IconButton
                        size="sm" variant="soft" color="primary" title="加入歌單"
                        onClick={() => enqueue({ videoId: it.videoId, title: it.title, thumbnail: it.thumbnail ?? null, durationSec: it.durationSec })}
                      >＋</IconButton>
                      <IconButton
                        size="sm" variant="solid" color="primary" title="立即播放此首"
                        onClick={() => { onPlayNow(it.videoId); onClose(); }}
                      >▶</IconButton>
                      <IconButton
                        size="sm" variant="plain" color="danger"
                        onClick={() => removePlayed(it.videoId)} title="從清單移除"
                      >✕</IconButton>
                    </Stack>
                  </Sheet>
                ))}
              </Stack>
            )}
          </>
        )}
      </Sheet>
    </Sheet>
  );
}
