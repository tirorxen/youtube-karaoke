import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "YouTube 卡拉 OK",
        short_name: "KTV",
        description: "本地 KTV — 去人聲、變調、麥克風混音、字幕逐字 fill",
        theme_color: "#101320",
        background_color: "#101010",
        display: "standalone",
        // window-controls-overlay：Win 11 Chrome 把標題列也吃掉、整個視窗給網頁；
        // standalone fallback：傳統 PWA mode（沒 URL bar / 沒分頁列）
        display_override: ["window-controls-overlay", "standalone"],
        start_url: "/",
        scope: "/",   // ★ 重要：包含 /stage.html，stage 子視窗也會用 standalone mode
        orientation: "landscape",
        icons: [
          {
            src: "icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // YouTube IFrame 等跨域資源不快取
        navigateFallbackDenylist: [/^\/api/, /youtube\.com/, /ytimg\.com/],
      },
    }),
  ],
  worker: {
    format: "es",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5174",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
