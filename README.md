# 🎤 YouTube 卡拉 OK（React PWA + 本地 Node Backend）

把筆電變成 KTV 機台：YouTube 上任何歌都能即時去人聲、Spotify 公開歌單一鍵匯入、
HDMI 接電視當大螢幕、手機當遙控器。**不用 app、不用上架、瀏覽器就能跑**。

> ⚠️ **本專案僅供個人使用。** 後端用 `yt-dlp` 抽 YouTube 串流並非 YouTube 服務條款允許的用途，
> 請不要拿來商業營運或重新散布內容。

---

## 📺 體驗預覽

| | 設備 | 用途 |
|---|---|---|
| 🎵 主畫面（dashboard） | 筆電瀏覽器 | 控制台 / Web Audio 引擎 / demucs 觸發 |
| 📺 舞台視窗 | 拖到電視 / 投影機 | KTV 大畫面 video + 字幕 + 下一首側欄 |
| 📱 手機遙控 | 同網域手機 | 沙發上點歌、搜尋、切歌、調導唱、Spotify 匯入 |

---

## ✨ 功能總覽

### 即時 KTV 處理
- 🎵 **三頻段去人聲**（Web Audio AudioWorklet）：貼 URL **10 秒內**能唱
- 🤖 **demucs 高品質去人聲**：背景跑 ML 分離，完成後**無縫 crossfade** 切到雙軌模式
- 🎚 **真．KTV 導唱**（demucs 雙軌）：人聲音量獨立控制，0% 純伴奏 / 100% 原唱
- 🎼 **雙讀頭 pitch shift**：即時升降 KEY，純音樂 ±5 半音內最自然
- 🎤 **麥克風混音**：getUserMedia 低延遲混入，可調對齊補償
- 📝 **逐字 fill 字幕**：YT CC 為主、lrclib.net 為輔，可手動換字幕 track

### 歌單管理
- 📋 **歌單佇列**：背景自動跑 demucs 預處理（一首一首 serial）
- 💾 **自動 snapshot**：每次歌單變動 5s 後自動存「📌 上一次的歌單」
- 📚 **命名歷史歌單**：手動命名儲存、追加/替換載入、cap 20
- 🔁 **已唱歌單**：自動記錄每首唱過的歌，cap 500，含 playCount
- 🎲 **隨機推薦**：從已唱歷史 Fisher-Yates 抽 6 首（空狀態頁）

### 🎶 Spotify 公開歌單匯入（**完全不用設定**）
- 直接爬 Spotify embed 頁面，**不用 Client ID / Secret**
- 4 階段 wizard（URL → 勾選 → 配對 → 預覽）
- 自動到 YT 搜尋最像「lyrics 影片」的對應 MV（標題含 lyrics +5、manual CC +3、auto CC +1、時長 ±15s +2）
- 一次最多 30 首，平行限 3 個並行

### 📱 手機遙控（同網域 WiFi）
- 點歌、切歌、⏪/⏩ 跳秒、🔄 重頭
- 五段導唱值 chip + 樂觀 UI（按下立即金色脈動，不用等 server）
- demucs 進度大字 % + ETA + ready 綠色慶祝
- 📚 過去歌單一鍵還原（追加 / 替換）
- 🎶 Spotify 匯入 wizard（手機完整可操作）
- 📋 切換舞台右側「下一首清單」
- 🎵 從歌詞庫（lrclib.net）重抓歌詞

### 📺 舞台模式（拖到 TV）
- 獨立 popup window 跑 `/stage.html`
- 影片置中（object-fit:contain）+ 字幕三行（prev/now/next）+ 右上角 HUD
- **右側側欄**：下一首大圖 + 接下來 3-5 首小圖 + prefetch 狀態 chip
  - 預設藏起來；手機 📋 按鈕切換；歌曲結尾 30s 自動跳出
- BroadcastChannel 同步狀態、Esc 退出全螢幕、F11 進真．全螢幕

---

## 📦 系統需求

- **Windows 10/11、macOS、Linux**（本文以 Windows 為主）
- **Node.js 18+**（含 npm）
- **Python 3.10+** + pip 套件：
  - `demucs`（Meta 的 ML 音源分離）
  - `torch` `torchaudio`（demucs 後端；CUDA 版可 GPU 加速）
  - `lameenc`（讓 demucs 走 mp3 輸出，繞過 torchaudio 2.5+ 的 torchcodec 問題）
- **yt-dlp**（最新版；YouTube 常改 API，舊版會壞）
- **ffmpeg**

### Windows 一條龍安裝

```powershell
# winget 一次裝完所有原生工具
winget install OpenJS.NodeJS
winget install Python.Python.3.12
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg

# Python 套件（CPU 版 PyTorch）
pip install demucs lameenc

# 若有 NVIDIA 顯卡（VRAM ≥ 3GB），裝 CUDA 版大幅加速 demucs
# 每首歌 1-8 分鐘 → 10-30 秒
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

---

## 🚀 第一次跑

```powershell
cd react_prototype
npm install
npm start
```

`npm start` 同時起兩個 process：
- **Vite dev server** → http://localhost:5173 （主畫面）
- **Express backend** → http://localhost:5174 （yt-dlp / demucs / Spotify / 手機遙控）

開瀏覽器到 **http://localhost:5173** 就能用了。

啟動 log 會印：

```
[cache] dir = C:\Users\ct131\.karaoke-cache
[gpu] ✅ NVIDIA GeForce RTX 3050 Ti VRAM 4.0GB CC 8.6 → 用 CUDA 加速 demucs（10-30 秒/首）
Karaoke backend listening on http://localhost:5174
📱 手機遙控（同一個 WiFi 下，手機瀏覽器開）：
   http://192.168.x.x:5174/remote
```

---

## ⭐ 推薦工作流程：裝成 PWA app

**強烈推薦**：dashboard 第一次跑時，Chrome 網址列右側會跳出「**安裝**」按鈕（或工具列有閃爍的「📲 裝成桌面 App」橘色按鈕）→ **按下去裝起來**。

裝完之後：
- 桌面會多一個「YouTube 卡拉 OK」捷徑
- **以後從桌面捷徑開**，dashboard 會在 **standalone app 視窗**（無瀏覽器 chrome，看起來像獨立 app）
- 按「📺 舞台」開出來的子視窗也會自動是 app 模式（**無 URL bar、無分頁列**）→ 視覺已接近全螢幕、不再需要點任何地方
- toolbar 會顯示綠色「📲 PWA 已裝」chip 確認

> 💡 **為什麼推薦裝 PWA**：瀏覽器規定 `requestFullscreen` API 一定要「使用者實體點擊」才會生效（network 觸發、phone 命令都不算）。PWA standalone mode 整個繞過這個限制，視覺直接無 chrome、根本不用呼叫 fullscreen API。

---

## 📱 手機遙控設定

1. 筆電與手機接**同一個 WiFi**
2. 第一次跑 Windows 防火牆會問 → 按 **允許「私人網路」存取**
3. 漏掉防火牆提示的話，**系統管理員 PowerShell** 跑：

   ```powershell
   New-NetFirewallRule -DisplayName "Karaoke Remote 5174" -Direction Inbound -LocalPort 5174 -Protocol TCP -Action Allow -Profile Any
   ```

4. 主畫面工具列點「**📱 手機遙控**」→ 跳 **QR code**，手機相機掃一下即開

手機那頁能幹的事：
- 🔍 搜尋 YT（含 CC 偵測標記）
- 📋 看歌單、加歌、▲▼ 重排、✕ 移除
- ▶ 立即播放某首（從歌單拿出）
- ⏪ -10s / ▶/⏸ / ⏩ +10s / 🔄 重頭 / ⏭ 切下一首
- 五段導唱值 chip（樂觀 UI 立即反映）
- 📺 進入舞台模式
- 📋 切換舞台右側「下一首清單」
- 📚 過去歌單（追加/替換）
- 🎶 Spotify 匯入 wizard
- 🎵 lrclib 重抓歌詞

---

## 🎶 Spotify 公開歌單匯入

### 一次性準備
1. 在 Spotify app 中建立或開啟你要的歌單
2. 點「**⋯**」→ **Share** → 確認狀態是「**Anyone with the link**」（公開）
3. 複製分享連結（會是 `https://open.spotify.com/playlist/...?si=...`）

### 匯入流程（任何裝置都行）
1. **手機**：滾到「📚 過去歌單」card 下方 → 「**🎶 從 Spotify 公開歌單匯入**」
   **桌面**：工具列「**🎶 Spotify 匯入**」（綠色按鈕）
2. 貼分享連結 → 「抓取歌單」（5-10 秒）
3. 全選前 30 首（或個別勾，第 31 首灰掉不能勾）
4. 「🔍 配對」→ backend 對每首跑 YT search 找 lyrics 影片（30 首約 2-4 分鐘）
5. 預覽結果（綠 CC chip = 有字幕、紅 chip = 沒找到）
6. 「➕ 全部加入歌單」→ 一次 enqueue 全部 → demucs prefetcher 排隊背景跑

> 💡 **不需要 Spotify Developer credentials**：本專案直接爬 Spotify embed 頁面的 JSON。Spotify 2024-11 起 API 強制 owner Premium 是廢的，我們繞過它。

---

## 🎬 舞台模式

### 設定（一次性）
1. 筆電 HDMI 接電視 / 投影機（顯示器設定改成「**延伸**」這個顯示器）
2. 把 Chrome 視窗拖到電視顯示器
3. 強烈推薦先**裝 PWA**（上面說過）

### 使用
- 主畫面「📺 舞台」按鈕 → 開出新 popup（也在電視顯示器上）
- **若已裝 PWA**：新 popup 就是 app 模式，無瀏覽器 chrome、視覺已是全螢幕
- **若沒裝 PWA**：popup 有 URL bar，按 **F11** 進真．全螢幕（或在 stage 視窗按任意處）
- 主畫面留在筆電當控制台，所有調整、切歌、加歌都從手機 + 主畫面
- 唱完一首歌結尾 30s 前，舞台右側自動跳出「接下來」側欄提醒準備
- 主畫面 / 手機改設定，舞台視窗即時同步（BroadcastChannel）

---

## ⌨️ 鍵盤捷徑

### 主畫面
| 鍵 | 動作 |
|---|---|
| `Esc` | 關閉舞台視窗 |

### 舞台視窗
| 鍵 | 動作 |
|---|---|
| `F11` | 進入/退出真．全螢幕 |
| `Esc` | 退出全螢幕 |
| `⛶` (按鈕) | 切換全螢幕 |
| `✕` (按鈕) | 關閉舞台視窗 |
| 任意點 / 按鍵 | 第一次互動 → 進入全螢幕（PWA 模式跳過） |

---

## 🛠️ Debug / 常見問題

| 症狀 | 原因 | 解法 |
|---|---|---|
| 貼 YT URL 報 `yt-dlp 60 秒沒回應` | yt-dlp 太舊（YouTube 改 API） | `winget upgrade yt-dlp.yt-dlp` |
| demucs 跑時 `No module named 'torchcodec'` | torchaudio 2.5+ 改後端 | `pip install lameenc`（本專案預設走 mp3） |
| demucs 跑很久才好 | 走 CPU | 裝 CUDA PyTorch（VRAM ≥ 3GB），或關「自動 demucs」用三頻段 |
| 手機連不上 5174 | 防火牆 | 上方「手機遙控設定」步驟 3 |
| 切歌後舞台沒切到新歌 | 已修（v.play 不重試 bug） | Ctrl+Shift+R 強制重整 + service worker 更新 |
| MV 卡頓 | dashboard + stage 兩份 video decode | 已修（stage 開啟時 dashboard video 自動 pause） |
| 字幕語言錯（Lady Gaga 變中文） | 已修（detectOriginalLang） | 還是錯就用「🔁 字幕」下拉換 track |
| 字幕 timing 對不準 | YT auto CC 對 MV 不準 | 「🔁 字幕」→「🎵 從歌詞庫重抓」用 lrclib synced LRC |
| Spotify 404 / 403 | 歌單不是公開 | Spotify app → ⋯ → Share → 確認「Anyone with the link」 |
| Spotify 抓回 0 首 | embed 網頁結構變了（罕見） | 設 `.env` 的 Client ID/Secret 啟用 API fallback |
| 舞台「點任意處進入全螢幕」很煩 | 沒裝 PWA | 裝 PWA！toolbar 那顆橘色閃爍按鈕 |

---

## 🏗️ 架構

完整視覺化系統圖：[**`architecture.html`**](architecture.html)（瀏覽器打開）

短版：

```
                                      ┌─────────────────────────────┐
       phone (任何瀏覽器)              │ laptop dashboard tab (5173) │
       /remote.html                    │                             │
       ──REST + polling──────────────► │ React + Web Audio worklets  │
       (state + commands)              │ AudioContext singleton      │
                                       │ trackA(原曲) trackB(伴奏)   │
   ┌───────────────────────────────►  │ trackC(人聲) mic → mixer    │
   │                                   └──┬──────────┬──────────────┘
   │                                      │          │ BroadcastChannel
   │                                      │          │ ("karaoke-stage")
   │                                      ▼          ▼
   │                            ┌─────────────────────────────┐
   │                            │ stage window (/stage.html)  │ ← 拖到 TV
   │                            │ video(muted) + lyrics + HUD │   + 右側下一首
   │                            └─────────────────────────────┘
   │                                      ▲
   │ Express backend (5174)               │  /api/youtube/visual
   ├──/api/youtube/quick     audio + meta + captions
   ├──/api/youtube/visual    video-only mp4
   ├──/api/youtube/instrumental  demucs no_vocals m4a
   ├──/api/youtube/vocals    demucs vocals m4a
   ├──/api/youtube/search    yt-dlp ytsearchN (含 CC 偵測)
   ├──/api/youtube/captions  YT CC tracks
   ├──/api/spotify/playlist  embed scraping
   ├──/api/spotify/match-yt  Spotify → YT lyrics video 配對
   ├──/api/cache/info /clear cache 管理
   ├──/api/remote/*          手機遙控 state/command 中繼
   └──/remote                手機遙控 HTML 頁

                                         ↕
                      yt-dlp（下載）+ ffmpeg（轉碼）+ demucs（ML 分離）
                      Spotify embed scraping（無需 credentials）
```

---

## 📂 專案結構

```
youtube-karaoke/
├── README.md                    （這個檔）
├── architecture.html            （視覺化架構圖，瀏覽器開）
├── LICENSE                      （MIT）
├── .gitignore
└── react_prototype/
    ├── package.json
    ├── vite.config.ts           （PWA manifest 在這裡）
    ├── tsconfig.json
    ├── index.html
    ├── public/
    │   ├── stage.html           （舞台視窗）
    │   ├── manifest.webmanifest
    │   └── icon-*.svg
    ├── src/
    │   ├── audio/               （Web Audio AudioEngine + 3 worklet processors）
    │   ├── components/          （所有 React 元件）
    │   ├── lyrics/              （LRC/SRT/VTT parser + lrclib client）
    │   ├── queue/               （Queue store + History snapshots）
    │   ├── played/              （已唱歌單 store）
    │   ├── recent/              （最近播放 store）
    │   ├── settings/            （Karaoke settings store）
    │   └── youtube/             （Backend client + parseId）
    ├── server/
    │   ├── server.mjs           （Express backend）
    │   └── remote.html          （手機遙控頁）
    ├── tests/                   （vitest 36 個測試）
    └── .env.example
```

---

## 🚫 為什麼放棄 Google Play 上架？

原本計畫做 Google TV App（`app/` `audio-dsp/` 等 Kotlin/NDK module），但實作後評估：

- **demucs 太吃運算**：手機/平板/Google TV box 跑 ML 推論超慢，UX 會崩
- **YT TOS**：`yt-dlp` 抽串流違反條款，無法商業上架
- **PWA 已夠**：筆電 + Web Audio + 本地 backend 就能完成 KTV 體驗，**還比原本 Android 計畫好用**

→ Android / Python 原型已撤掉，完整功能都在 `react_prototype/`。

---

## 🤝 貢獻

歡迎 issue / PR。重要原則：
- **個人使用為前提**，避免任何用於商業營運的 PR
- 演算法改動請附 vitest 測試（看 `tests/vocal-remover-ref.test.ts` 風格）
- UI 改動請手動測「切歌 → 自動 demucs → crossfade」整套流程
- 新增的 deps 請確認跨平台（Win/macOS/Linux）

---

## 📄 授權

**MIT License**（看 `LICENSE`）。**僅供個人使用**，請尊重 YouTube 與內容創作者的權利。

> 本專案使用 yt-dlp 抽 YouTube 串流，此用法違反 YouTube 服務條款第 III.E.4 條。
> 個人本機使用通常不被追究，但**禁止任何形式的散布、商業營運、或重新發布內容**。
