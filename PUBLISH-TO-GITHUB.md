# 📤 上傳到 GitHub 步驟

這份**乾淨副本**已經自動排除：個人 `.env`、`node_modules`、`.media-cache`、`dist`、
其他編譯產物，可以直接 push 上 GitHub。

---

## 1. 在 GitHub 建立空 repo

1. 到 https://github.com/new
2. Repo name：建議 `youtube-karaoke` 或 `karaoke-pwa`（**英文，避免 CJK，git/clone/path 比較順**）
3. **不要**勾「Initialize with README」（我們有了）
4. **不要**勾 .gitignore / LICENSE（也都有了）
5. 按 **Create repository**
6. GitHub 會給你 `https://github.com/<你的帳號>/<repo-name>.git`

---

## 2. 本機初始化 git + push

開 PowerShell 或 Git Bash，到這個資料夾：

```bash
cd "C:\Users\ct131\OneDrive\Desktop\youtube-karaoke-share"
```

第一次 git 初始化（如果你還沒設過全域 user）：

```bash
git config --global user.name "你的名字"
git config --global user.email "your@email.com"
```

然後：

```bash
git init -b main
git add .
git commit -m "Initial commit: YouTube 卡拉 OK PWA"

# 把剛建的 GitHub repo 加為 remote
git remote add origin https://github.com/<你的帳號>/<repo-name>.git

# Push
git push -u origin main
```

完成。瀏覽器重整你的 GitHub repo 應該就看得到所有檔案。

---

## 3. （可選）建議的 GitHub repo 設定

### About 區域填一下
- Description：`本地 KTV — YouTube 即時去人聲、Spotify 公開歌單匯入、手機遙控`
- Website：留空或填你的部落格
- Topics（標籤）：`karaoke` `youtube` `pwa` `demucs` `web-audio` `spotify` `react` `vite`

### README.md 自動成為首頁 ✓
README.md 已經是完整 doc 了，GitHub 會自動 render 在 repo 首頁。

### 加個截圖（可選但加分很多）
- 自己玩過程隨手截幾張：dashboard / 手機 wizard / 舞台模式 / Spotify import
- 上傳到 repo 的 `docs/screenshots/` 然後在 README 加一段 `## 截圖` 引用

### 主題分頁 GitHub Discussions
Repo Settings → Features → 勾「Discussions」→ 讓使用者問問題不用全部開 issue。

### 啟用 Issue Templates
Settings → Features → Set up templates → Bug report / Feature request 各一份。

---

## 4. ⚠️ 上傳前最後檢查

push 之前看一眼：

```bash
git status
git ls-files | head -30
```

確認**沒有**：
- `.env`（你的 Spotify 真實 secrets）
- `react_prototype/.media-cache/`（歌曲 cache，可能幾百 MB）
- `react_prototype/node_modules/`（依賴）
- `react_prototype/dist/`（編譯產物）

這份副本已經幫你排除了，但你之後 `git add` 新檔時請繼續注意這條原則。
`.gitignore` 已包含這些路徑、會自動擋。

---

## 5. 法律 / 倫理叮嚀

**請在 repo description 或 README 開頭就清楚標示「個人使用」**。本專案使用 `yt-dlp`
抽 YouTube 串流違反 YT TOS 第 III.E.4 條：

- ❌ 不要拿來商業營運
- ❌ 不要散布或重新發布抽到的內容
- ❌ 不要用 GitHub Pages / Vercel 等公開服務 host 跑這個 backend
- ✅ 可以分享 source code 給他人在自己電腦 self-host

如果哪天 YouTube / RIAA / 任何方寄你 takedown，乖乖照辦並把 repo 設 private 即可。

---

## 6. 後續 push 更新

之後改了什麼，常規 git workflow：

```bash
cd "C:\Users\ct131\OneDrive\Desktop\youtube-karaoke-share"
git add .
git commit -m "說明這次改了什麼"
git push
```

但**這個資料夾是「乾淨副本」**，你平常開發應該還是在原本 `C:\Users\ct131\OneDrive\Desktop\youtube卡拉OK\react_prototype\`。
要把改動同步進這份副本的話：
- 手動複製改動過的檔案過來
- 或之後乾脆把開發路徑也改成這份（把 `.env` 跟 `node_modules` 重新建一次即可）

---

完成。Happy KTV 🎤
