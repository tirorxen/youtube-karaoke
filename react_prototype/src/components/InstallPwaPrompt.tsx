/**
 * PWA 安裝按鈕：給 toolbar 用。瀏覽器支援且沒裝過時才顯示。
 *
 * 為什麼裝 PWA：window.open 開出來的舞台視窗會繼承 PWA standalone mode →
 *   **沒有瀏覽器 chrome（沒 URL bar / 沒分頁列）→ 視覺上就接近全螢幕**，根本
 *   不用呼叫 fullscreen API、不用 user activation。對網路指令觸發的舞台模式
 *   是唯一可靠的全螢幕方案。
 *
 * 機制：Chrome / Edge 認為網站符合 PWA 條件（manifest + service worker + 同源）
 * 會在某一刻 fire `beforeinstallprompt`。捕捉它、保存 deferredPrompt、之後
 * 使用者點按鈕就呼叫 `prompt()` 跳安裝對話框。已裝/不支援的瀏覽器：不顯示。
 */
import { Button, Chip } from "@mui/joy";
import { useEffect, useState } from "react";

// Chromium 的 BeforeInstallPromptEvent type，TS 預設沒帶
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function InstallPwaPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches
  );

  useEffect(() => {
    const onBefore = (e: Event) => {
      e.preventDefault();   // 不要讓 Chrome 自己跳，我們控制時機
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // 已經以 standalone 模式跑 → 顯示一個小綠 chip 提示「已安裝」
  if (installed) {
    return <Chip size="sm" color="success" variant="soft" title="PWA app 模式，舞台視窗會無 chrome">📲 PWA 已裝</Chip>;
  }
  if (!prompt) return null;
  return (
    <Button
      size="sm" variant="solid" color="warning"
      onClick={async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") setPrompt(null);
      }}
      title="★ 推薦 ★ 裝成桌面 app → 舞台視窗開啟時直接無瀏覽器 chrome，視覺即全螢幕、不再需要點任意處"
      sx={{
        animation: "pwa-pulse 2s ease-in-out infinite",
        "@keyframes pwa-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(255, 138, 61, 0.5)" },
          "50%":      { boxShadow: "0 0 0 6px rgba(255, 138, 61, 0)" },
        },
      }}
    >
      📲 裝成桌面 App（推薦）
    </Button>
  );
}
