/**
 * 歌單背景預處理（headless）— 像真 KTV：排隊的歌先在背景跑 demucs，輪到時 instant。
 *
 * 策略：**一次只處理一首**（demucs 很吃 CPU，平行跑會互相拖慢）。
 * 掃描 queue，挑第一個還沒處理的，對 instrumental endpoint 發 HEAD：
 * backend 會跑完 demucs（兩軌 cache 到 disk）才回 200 → 標記 ready。
 *
 * HEAD 完成後 cache 已暖；輪到該首時 triggerHighQualityAuto 幾乎瞬間 crossfade。
 */
import { useEffect, useRef } from "react";

import { useQueue } from "../queue/store";
import { useSettings } from "../settings/store";
import { youtubeInstrumentalUrl } from "../youtube/backendClient";

export function QueuePrefetcher() {
  const items = useQueue((s) => s.items);
  const prefetch = useQueue((s) => s.prefetch);
  const setPrefetch = useQueue((s) => s.setPrefetch);
  const model = useSettings((s) => s.settings.demucsModel);
  const busyRef = useRef(false);

  useEffect(() => {
    if (busyRef.current) return;
    // 找第一個尚未開始處理的（undefined / idle / 換 model 後想重試的 failed 不自動重試）
    const target = items.find((it) => {
      const st = prefetch[it.videoId];
      return st === undefined || st === "idle";
    });
    if (!target) return;

    busyRef.current = true;
    setPrefetch(target.videoId, "processing");
    const url = youtubeInstrumentalUrl(target.videoId, model);
    console.log("[queue-prefetch] warming demucs for", target.videoId, target.title);

    // HEAD 觸發 demucs 並等完成（與正在播放那首共用 backend inflight map，不會重跑）
    fetch(url, { method: "HEAD" })
      .then((r) => {
        setPrefetch(target.videoId, r.ok ? "ready" : "failed");
        console.log("[queue-prefetch]", target.videoId, r.ok ? "ready ✓" : `failed (${r.status})`);
      })
      .catch((e) => {
        setPrefetch(target.videoId, "failed");
        console.warn("[queue-prefetch] failed", target.videoId, e);
      })
      .finally(() => {
        busyRef.current = false;
      });
  }, [items, prefetch, model, setPrefetch]);

  return null;
}
