/**
 * YouTube IFrame Player wrapper。
 *
 * 採合規 IFrame Player API：影片畫面顯示，音訊在 IFrame 內靜音
 * （`mute()`），讓本地 audio engine 當主音軌。
 *
 * 廣告偵測：透過 `.ad-showing` className 觀察（YouTube CSS 不保證穩定，
 * 僅作為 hint；正式版需註冊官方 onAdStateChange）。
 */
import { useEffect, useRef } from "react";

import { observeAds } from "./premiumDetect";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiPromise;
}

interface Props {
  videoId: string | null;
  onAdStart?: () => void;
  onAdEnd?: () => void;
  onReady?: (player: any) => void;
}

export function IframePlayer({ videoId, onAdStart, onAdEnd, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!videoId || !containerRef.current) return;

    let cancelled = false;
    let stopAdObserver: (() => void) | null = null;

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute();          // 我們用本地音檔當主音
            onReady?.(e.target);
          },
        },
      });
      stopAdObserver = observeAds(onAdStart, onAdEnd);
    });

    return () => {
      cancelled = true;
      if (stopAdObserver) stopAdObserver();
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, onAdStart, onAdEnd, onReady]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#000" }}
    />
  );
}
