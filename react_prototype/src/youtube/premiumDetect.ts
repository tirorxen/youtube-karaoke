/**
 * 偵測 YouTube IFrame 內是否有廣告播放。
 *
 * 因為 IFrame Player API 不暴露官方 onAdStateChange，這裡用 DOM observer
 * 觀察 `.ad-showing` className。跨 origin 限制下我們只能觀察 IFrame 外層 wrapper；
 * 內部 DOM 不能直接 query。實務上 YouTube 廣告會切換 IFrame src，
 * 可作為 hint 通報。
 */

const POLL_INTERVAL_MS = 500;

export function observeAds(
  onAdStart?: () => void,
  onAdEnd?: () => void
): () => void {
  let lastIsAd = false;
  const id = window.setInterval(() => {
    // 找頁面中所有 YouTube iframe wrapper，檢查 className 是否含 ad-showing
    const wrappers = document.querySelectorAll(
      'iframe[src*="youtube.com/embed"]'
    );
    let nowIsAd = false;
    wrappers.forEach((el) => {
      const cls = el.className || "";
      if (cls.includes("ad-showing")) nowIsAd = true;
    });
    if (nowIsAd && !lastIsAd) onAdStart?.();
    if (!nowIsAd && lastIsAd) onAdEnd?.();
    lastIsAd = nowIsAd;
  }, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}
