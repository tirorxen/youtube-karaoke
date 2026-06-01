/**
 * Local YouTube proxy backend for the React PWA.
 *
 * Endpoints:
 *   GET  /api/youtube/resolve?url=...               -> metadata + caption list
 *   GET  /api/youtube/stream?id=...&fmt=m4a|webm    -> 下載到 tmp 後 sendFile（支援 HTTP Range）
 *   GET  /api/youtube/captions?id=...&lang=zh-TW    -> 純文字 VTT
 *   GET  /api/health                                -> { ok: true }
 *
 * 依賴系統有 yt-dlp 在 PATH（winget install yt-dlp）。
 *
 * 注意：抽 YouTube 音訊串流違反 YouTube TOS，本檔僅供個人使用。
 */

import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader（避免加 dotenv 依賴）。優先讀專案根的 .env，找不到讀 server/.env。
// 主要拿來載 SPOTIFY_CLIENT_ID / SECRET，其他 env vars 可繼續從 command line 設。
for (const candidate of [path.join(__dirname, "..", ".env"), path.join(__dirname, ".env")]) {
  if (!fs.existsSync(candidate)) continue;
  for (const line of fs.readFileSync(candidate, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  console.log(`[env] loaded ${candidate}`);
  break;
}

/**
 * 跑外部命令並 stream stderr 到 console（即時看進度）。
 * 同時嘗試多組命令，第一個能跑的就用。
 *
 * @param {Array<{cmd:string, args:string[]}>} candidates
 * @param {string} label  log 前綴
 * @returns {Promise<void>}
 */
function spawnWithFallback(candidates, label, onChunk) {
  return new Promise(async (resolve, reject) => {
    let lastErr = null;
    for (const { cmd, args } of candidates) {
      try {
        await new Promise((res, rej) => {
          console.log(`[${label}] spawning: ${cmd} ${args.join(" ")}`);
          const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
          let stderrBuf = "";
          child.stdout.on("data", (d) => {
            const s = d.toString();
            process.stdout.write(`[${label}:out] ${s}`);
            if (onChunk) onChunk(s);
          });
          child.stderr.on("data", (d) => {
            const s = d.toString();
            stderrBuf += s;
            process.stderr.write(`[${label}:err] ${s}`);
            if (onChunk) onChunk(s);
          });
          child.on("error", (err) => {
            // ENOENT 等：命令不存在，往下試下一個 candidate
            if (err.code === "ENOENT") rej({ enoent: true, err });
            else rej({ enoent: false, err, stderr: stderrBuf });
          });
          child.on("exit", (code) => {
            if (code === 0) res();
            else rej({ enoent: false, err: new Error(`exit ${code}`), stderr: stderrBuf });
          });
        });
        resolve();
        return;
      } catch (e) {
        lastErr = e;
        if (e.enoent) {
          console.warn(`[${label}] '${cmd}' 不在 PATH，試下一個…`);
          continue;
        }
        // 命令存在但執行失敗 → 不再 fallback，直接 reject
        reject(new Error(`${label} 失敗：${e.err?.message || e}\nstderr: ${e.stderr || "(none)"}`));
        return;
      }
    }
    reject(new Error(`${label} 所有候選命令都不存在。Lastest: ${lastErr?.err?.message}`));
  });
}

const app = express();
app.use(express.json({ limit: "1mb" }));   // 手機遙控 POST body
const PORT = Number(process.env.KARAOKE_PORT ?? 5174);

// 快取目錄：每首歌只下載一次（key = videoId + fmt）。永久持久化。
// 必須避開兩個地雷：
//   1. **路徑含中文** → demucs（Python）在 Windows 上 spawn 對 CJK 路徑超脆弱，
//      會直接「去人聲失敗」。專案路徑 youtube卡拉OK\react_prototype\.media-cache 含中文。
//   2. **OneDrive 同步資料夾** → OneDrive 即時同步大檔 vs yt-dlp 寫入會搶 file handle。
// 解法：放 `~/.karaoke-cache`（純 ASCII、不在 OneDrive 內、跨平台都穩）。
// 想改位置（例：放外接 SSD）設環境變數 KARAOKE_CACHE_DIR 即可。
const CACHE_DIR = process.env.KARAOKE_CACHE_DIR ?? path.join(os.homedir(), ".karaoke-cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });
console.log(`[cache] dir = ${CACHE_DIR}`);

/** 遞迴算目錄總大小與檔數。 */
function dirSize(dir) {
  let bytes = 0, files = 0;
  if (!fs.existsSync(dir)) return { bytes, files };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = dirSize(full);
        bytes += sub.bytes; files += sub.files;
      } else {
        bytes += fs.statSync(full).size; files++;
      }
    } catch { /* ignore */ }
  }
  return { bytes, files };
}

/** 清空目錄內所有檔案/子目錄；正在下載中的會被 `inflightDownloads` 擋下不重複，所以這裡直接砍。 */
function clearDir(dir) {
  let bytes = 0, files = 0;
  if (!fs.existsSync(dir)) return { bytes, files };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = dirSize(full);
        bytes += sub.bytes; files += sub.files;
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        bytes += fs.statSync(full).size; files++;
        fs.unlinkSync(full);
      }
    } catch (e) { console.warn(`[cache] could not delete ${full}: ${e?.message ?? e}`); }
  }
  return { bytes, files };
}

// 同 videoId+fmt 同時間只允許一個下載 promise
const inflightDownloads = new Map();

/**
 * 即時進度狀態：key = `${videoId}:${model}`，value:
 *   {
 *     stage:    "audio_download" | "demucs" | "ffmpeg_mux" | "done" | "error",
 *     percent:  0-100,
 *     modelN / totalModels:  demucs 第 N / 共 N 個模型（bag of N）
 *     elapsedSec: 經過秒數
 *     startTs:  Date.now() 起點
 *     message:  狀態描述
 *     error?:   錯誤訊息
 *   }
 */
const progressMap = new Map();

function progressKey(videoId, model) {
  return `${videoId}:${model || "default"}`;
}

function setProgress(key, patch) {
  const cur = progressMap.get(key) || { startTs: Date.now() };
  const next = {
    ...cur,
    ...patch,
    elapsedSec: Math.floor((Date.now() - (cur.startTs ?? Date.now())) / 1000),
  };
  progressMap.set(key, next);
}

/**
 * 解析 demucs 在 stderr 印的 tqdm 進度條。
 * mdx_extra_q 是 bag of 4：每個 model 一條 0%→100% 進度條。
 * 我們用「當前 % 比上次顯著降低 → 視為新 model 開始」追蹤 modelN。
 */
function makeDemucsProgressParser(key) {
  let modelN = 1;
  let totalModels = 1;
  let lastPct = 0;
  let lastLogBucket = -1;   // 節流 console.log（每跳 5% 印一次）

  return function onChunk(text) {
    // 偵測 bag size：「bag of 4 models」
    const bag = text.match(/bag of (\d+) models/i);
    if (bag) {
      totalModels = Number(bag[1]);
      setProgress(key, { stage: "demucs", modelN, totalModels });
    }

    // 抓 tqdm ETA：`[00:11<01:10, 3.24seconds/s]` → elapsed 11s, eta 70s
    const etaMatch = text.match(/\[(\d+):(\d{2})<(\d+):(\d{2})/);
    let etaSec;
    if (etaMatch) {
      etaSec = Number(etaMatch[3]) * 60 + Number(etaMatch[4]);
    }

    // 抓所有百分比；取最後一個（最新狀態）
    const pcts = [...text.matchAll(/(\d{1,3})(?:\.\d+)?%/g)].map((m) => Number(m[1]));
    if (pcts.length === 0) {
      if (etaSec !== undefined) setProgress(key, { etaSec });
      return;
    }
    const cur = pcts[pcts.length - 1];
    if (cur < lastPct - 20 && modelN < totalModels) modelN += 1;
    lastPct = cur;
    const local = cur / 100;
    const globalPct = (((modelN - 1) + local) / totalModels) * 100;

    setProgress(key, {
      stage: "demucs",
      modelN,
      totalModels,
      percent: Math.min(99, globalPct),
      etaSec,
      message: `分離中：模型 ${modelN}/${totalModels}，${cur}%`,
    });

    // 節流 console.log：每跳 5% 印一行
    const bucket = Math.floor(globalPct / 5);
    if (bucket !== lastLogBucket) {
      lastLogBucket = bucket;
      const etaStr = etaSec !== undefined
        ? ` eta ${Math.floor(etaSec / 60)}:${String(etaSec % 60).padStart(2, "0")}`
        : "";
      console.log(`[progress] ${key} ${globalPct.toFixed(0)}%${etaStr}`);
    }
  };
}

// ---- Helpers ----------------------------------------------------------------

function parseYouTubeId(input) {
  try {
    const u = new URL(input);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("embed");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  }
  return null;
}

/**
 * Promise.allSettled 風格但限制 N 個並行（避免一次 spawn 12 個 yt-dlp 把機器跑爆）。
 */
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: String(e?.message ?? e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * 搜尋專用的輕量字幕偵測：跑 --dump-single-json 抓 subtitles + automatic_captions。
 * 不像 ytdlpJson 那樣允許 60s timeout（搜尋時不能等這麼久）—— 12s 內沒回就放棄，
 * 那筆結果就不顯示 CC 徽章（不影響可用性）。
 */
async function quickCaptionCheck(videoId) {
  try {
    const { stdout } = await execFile(
      "yt-dlp",
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
      ],
      { maxBuffer: 20 * 1024 * 1024, timeout: 12_000 },
    );
    const info = JSON.parse(stdout);
    const subs = info?.subtitles ?? {};
    const auto = info?.automatic_captions ?? {};
    return {
      hasManualCaptions: Object.keys(subs).length > 0,
      hasAutoCaptions: Object.keys(auto).length > 0,
      detectedLang: info?.language ?? null,
    };
  } catch {
    return { hasManualCaptions: false, hasAutoCaptions: false, detectedLang: null };
  }
}

/**
 * 用 yt-dlp 搜尋 YouTube（不用 API key）。
 * `ytsearch10:keyword` 回前 10 筆，含 title / id / thumbnail / duration / channel
 * + 是否有 CC 字幕（讓使用者一眼看出哪些歌可唱）。
 */
async function ytdlpSearch(query, limit = 12) {
  // yt-dlp 每行回一筆 JSON
  const { stdout } = await execFile(
    "yt-dlp",
    [
      `ytsearch${limit}:${query}`,
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--skip-download",
    ],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
  const basic = lines.map((l) => {
    try {
      const j = JSON.parse(l);
      return {
        videoId: j.id,
        title: j.title,
        channel: j.uploader || j.channel,
        durationSec: j.duration ?? 0,
        thumbnail:
          j.thumbnail ||
          (j.thumbnails && j.thumbnails[j.thumbnails.length - 1]?.url) ||
          (j.id ? `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg` : null),
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  // 平行（最多 4 個並行）對每筆查 CC 字幕狀態。各筆 12s timeout，整體大約 5-10s。
  console.log(`[search] enriching ${basic.length} results with caption info…`);
  const t0 = Date.now();
  const enriched = await mapWithLimit(basic, 4, async (r) => {
    const cc = await quickCaptionCheck(r.videoId);
    return { ...r, ...cc };
  });
  console.log(`[search] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return enriched;
}

async function ytdlpJson(videoId) {
  console.log(`[yt-dlp] fetching metadata for ${videoId}…`);
  const t0 = Date.now();
  try {
    const { stdout } = await execFile(
      "yt-dlp",
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        // 注意：dump-single-json 已含完整 subtitles / automatic_captions metadata，
        // 不需要 --write-sub / --sub-langs（那是用來「下載字幕檔」的，且新版
        // yt-dlp 對 --sub-langs 的 `*` 會報 "Wrong regex for subtitlelangs"）。
      ],
      {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60_000,           // 60 秒卡住直接 abort
      }
    );
    console.log(`[yt-dlp] metadata ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return JSON.parse(stdout);
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.error(`[yt-dlp] FAILED for ${videoId}:`, msg);
    if (e?.killed || msg.includes("ETIMEDOUT")) {
      throw new Error(
        "yt-dlp 60 秒沒回應。常見原因：\n" +
          "  1. yt-dlp 太舊（YouTube 改 API）→ 跑 `winget upgrade yt-dlp.yt-dlp`\n" +
          "  2. 網路慢 / VPN\n" +
          "  3. 該影片有地區限制或下架"
      );
    }
    if (e?.code === "ENOENT") {
      throw new Error("yt-dlp 不在 PATH。請 `winget install yt-dlp.yt-dlp` 後重啟 backend。");
    }
    throw new Error(`yt-dlp metadata 失敗：${msg}`);
  }
}

function pickBestAudio(info) {
  const formats = info?.formats ?? [];
  const audioOnly = formats
    .filter((f) => f.vcodec === "none" && f.acodec !== "none" && f.url)
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  if (audioOnly[0]) return audioOnly[0];
  const merged = formats
    .filter((f) => f.acodec !== "none" && f.url)
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  return merged[0] ?? null;
}

/**
 * 偵測影片「原文語言」。順序：
 *   1. yt-dlp metadata 的 info.language（最準）
 *   2. info.subtitles 裡如果只有一個 manual lang，假設那就是原文
 *   3. 標題的 CJK 偵測 → ja / ko / zh
 *   4. fallback "en"
 *
 * 為什麼要：YouTube 對熱門 MV（例：Lady Gaga）會自動把英文 CC 翻譯成 zh-TW；
 * 直接拿 zh-TW 變成亂翻的中文歌詞。要避免就只挑「原文」+「manual」優先。
 */
function detectOriginalLang(info, title) {
  if (info?.language && typeof info.language === "string") {
    return info.language.toLowerCase().split("-")[0]; // 取 base lang
  }
  const subs = info?.subtitles ?? {};
  const subKeys = Object.keys(subs);
  if (subKeys.length === 1) {
    return subKeys[0].toLowerCase().split("-")[0];
  }
  const s = String(title || "");
  if (/[぀-ゟ゠-ヿ]/.test(s)) return "ja";          // 平假名/片假名
  if (/[가-힯]/.test(s)) return "ko";                       // 韓文
  if (/[一-鿿]/.test(s)) return "zh";                       // 中日韓統一漢字
  return "en";
}

/**
 * 從 info.subtitles + info.automatic_captions 挑「最該用的字幕」。
 * 優先序（不會落到「auto 翻譯成 zh-TW」這種爛東西）：
 *   1. manual 原文（manual subtitles 在 origLang）
 *   2. manual 原文 base 變體（en-US → en）
 *   3. auto 原文（automatic_captions 在 origLang）— 同語言的 STT 通常還可看
 *   4. manual 任何語（如果有人特地上傳了一個版本）
 *   5. ❌ 不要 fallback 到 auto 的其他語言（那 100% 是 YouTube 自動翻譯，極爛）
 *
 * 回傳 { lang, source: "manual" | "auto" } 或 null。
 */
function pickBestCaptionLang(info, origLang) {
  const subs = info?.subtitles ?? {};
  const auto = info?.automatic_captions ?? {};
  const matchLang = (pool, target) => {
    if (pool[target]) return target;
    // base lang match (例：要 "en"，pool 有 "en-US"/"en-GB")
    const base = target.split("-")[0];
    for (const k of Object.keys(pool)) {
      if (k.toLowerCase().split("-")[0] === base) return k;
    }
    return null;
  };

  // 1+2: manual in origLang or base variant
  const manualOrig = matchLang(subs, origLang);
  if (manualOrig) return { lang: manualOrig, source: "manual" };

  // 3: auto in origLang (同語言 STT；同為英文歌就吃英文 STT，不會被翻成中文)
  const autoOrig = matchLang(auto, origLang);
  if (autoOrig) return { lang: autoOrig, source: "auto" };

  // 4: 任何 manual 字幕（人工上傳的通常品質高）
  const anyManual = Object.keys(subs)[0];
  if (anyManual) return { lang: anyManual, source: "manual" };

  return null;
}

/**
 * 列出該影片所有「實用」字幕 track，給前端做「🔁 重挑字幕」下拉用。
 * 全部 manual + 原文/英文/中文/日韓 自動字幕（其他 auto 語言都是亂翻譯）。
 */
function listCaptionTracks(info, origLang) {
  const subs = info?.subtitles ?? {};
  const auto = info?.automatic_captions ?? {};
  const out = [];
  for (const lang of Object.keys(subs)) {
    out.push({ lang, source: "manual", label: `${lang}（人工）` });
  }
  const wanted = new Set([
    origLang, (origLang || "").split("-")[0],
    "en", "en-US", "en-GB",
    "zh-TW", "zh-Hant", "zh", "zh-CN", "zh-Hans",
    "ja", "ko",
  ].filter(Boolean));
  for (const lang of Object.keys(auto)) {
    if (wanted.has(lang) || wanted.has(lang.split("-")[0])) {
      out.push({ lang, source: "auto", label: `${lang}（自動）` });
    }
  }
  return out;
}

function collectCaptions(info) {
  const out = [];
  const seen = new Set();
  const push = (langCode, label, tracks, source) => {
    if (!langCode || seen.has(langCode + source)) return;
    seen.add(langCode + source);
    out.push({ lang: langCode, label, source, tracks });
  };
  const subs = info?.subtitles ?? {};
  const auto = info?.automatic_captions ?? {};
  for (const [code, tracks] of Object.entries(subs)) push(code, `${code}（人工）`, tracks, "manual");
  for (const [code, tracks] of Object.entries(auto)) push(code, `${code}（自動）`, tracks, "auto");
  return out;
}

/**
 * 把 YouTube 音訊下載到 tmp 檔案（如果尚未存在）。回傳檔案路徑。
 * fmt:
 *   - "m4a"（預設，AAC，相容性最好）
 *   - "webm"（Opus，size 小但 Safari/某些瀏覽器不解）
 */
async function ensureAudioCached(videoId, fmt = "m4a") {
  const fileName = `${videoId}.${fmt}`;
  const filePath = path.join(CACHE_DIR, fileName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;

  const key = `${videoId}:${fmt}`;
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  const ytFormat =
    fmt === "webm"
      ? "bestaudio[ext=webm]/bestaudio"
      : "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio";

  const promise = (async () => {
    console.log(`[yt-dlp] downloading ${videoId} (${fmt})...`);
    await execFile(
      "yt-dlp",
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        "-f", ytFormat,
        "-o", filePath,
        "--no-playlist",
        "--no-warnings",
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    console.log(`[yt-dlp] done: ${filePath}`);
    return filePath;
  })();
  inflightDownloads.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightDownloads.delete(key);
  }
}

/**
 * 下載 muxed mp4（video+audio）。前端用 <video> 一次播畫面+聲音，
 * 影片畫面跟 KTV 處理音訊共用同一個 timeline → 完美同步。
 */
/**
 * 抽**video-only**（無音軌）mp4 給 <video> 顯示畫面用。
 * 比 muxed mp4 小、下載快、不會卡 audio 抽取邏輯。
 *
 * 為什麼分開：三階段架構下 audio 跟 video 各走自己的 endpoint，互不阻塞。
 */
async function ensureVideoOnlyCached(videoId) {
  const filePath = path.join(CACHE_DIR, `${videoId}.video-only.mp4`);
  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    if (size > 100_000) {
      console.log(`[yt-dlp] video-only cache hit: ${filePath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return filePath;
    } else {
      console.warn(`[yt-dlp] video-only cache corrupt (${size}B), re-downloading`);
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  const key = `${videoId}:video-only`;
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  const promise = (async () => {
    console.log(`[yt-dlp] downloading video-only ${videoId}...`);
    const t0 = Date.now();
    try {
      await execFile(
        "yt-dlp",
        [
          `https://www.youtube.com/watch?v=${videoId}`,
          "-f", "bestvideo[ext=mp4][height<=720]/bestvideo[height<=720]/bestvideo",
          "-o", filePath,
          "--no-playlist",
          "--no-warnings",
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 180_000 }   // 3 分鐘
      );
      console.log(`[yt-dlp] video-only done: ${filePath} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.error(`[yt-dlp] video-only FAILED for ${videoId}:`, String(e?.message ?? e));
      throw new Error(`yt-dlp video-only 下載失敗：${String(e?.message ?? e)}`);
    }
    return filePath;
  })();
  inflightDownloads.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightDownloads.delete(key);
  }
}

async function ensureVideoCached(videoId) {
  const fileName = `${videoId}.mp4`;
  const filePath = path.join(CACHE_DIR, fileName);
  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    if (size > 100_000) {
      console.log(`[yt-dlp] cache hit: ${filePath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return filePath;
    } else {
      // 之前下載中斷留下不到 100KB 的破檔 → 刪掉重抓
      console.warn(`[yt-dlp] cache corrupt (${size}B), re-downloading: ${filePath}`);
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  const key = `${videoId}:mp4`;
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  const promise = (async () => {
    console.log(`[yt-dlp] downloading muxed mp4 ${videoId}...`);
    const t0 = Date.now();
    try {
      await execFile(
        "yt-dlp",
        [
          `https://www.youtube.com/watch?v=${videoId}`,
          // 優先選 mp4 軌；找不到就讓 ffmpeg 合併
          "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]",
          "--merge-output-format", "mp4",
          "-o", filePath,
          "--no-playlist",
          "--no-warnings",
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 } // 5 分鐘
      );
      console.log(`[yt-dlp] done: ${filePath} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      const msg = String(e?.message ?? e);
      console.error(`[yt-dlp] mp4 download FAILED for ${videoId}:`, msg);
      throw new Error(`yt-dlp mp4 下載失敗：${msg}`);
    }
    return filePath;
  })();
  inflightDownloads.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightDownloads.delete(key);
  }
}

/**
 * 把 muxed video 跟分離後的 no_vocals 音軌再 mux 一次：
 * 輸出「視訊原樣 + 音訊換成 no_vocals」的 mp4 → 前端單 <video> 元素就能完美同步。
 */
async function ensureNoVocalsVideoCached(videoId, model = "htdemucs") {
  // cache key 含 model，不同 model 各自 cache
  const outFile = path.join(CACHE_DIR, `${videoId}.nv-${model}.mp4`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return outFile;

  const key = `${videoId}:nvmp4:${model}`;
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  const promise = (async () => {
    // 並行：muxed video + 分離 audio（demucs 慢，video 下載快，等 demucs 即可）
    const [videoFile, noVocalsAudio] = await Promise.all([
      ensureVideoCached(videoId),
      ensureSeparatedAudio(videoId, model),
    ]);
    console.log(`[ffmpeg] mux video + no_vocals -> ${outFile}`);
    const muxStart = Date.now();
    try {
      // 改 spawn + stderr 流 + 120s timeout（mp4+m4a 重 mux 用 -c:v copy 應該 < 10 秒）
      await spawnWithFallback(
        [
          {
            cmd: "ffmpeg",
            args: [
              "-y",
              "-hide_banner",
              "-loglevel", "warning",
              "-i", videoFile,
              "-i", noVocalsAudio,
              "-map", "0:v:0",
              "-map", "1:a:0",
              "-c:v", "copy",
              "-c:a", "aac",
              "-b:a", "192k",
              "-movflags", "+faststart",
              "-shortest",
              outFile,
            ],
          },
        ],
        "ffmpeg-mux",
      );
      console.log(`[ffmpeg] mux done in ${((Date.now() - muxStart) / 1000).toFixed(1)}s`);
    } catch (e) {
      // 失敗時清掉可能寫到一半的破檔
      try { fs.unlinkSync(outFile); } catch { /* ignore */ }
      const msg = String(e?.message ?? e);
      if (msg.includes("所有候選命令都不存在")) {
        throw new Error("ffmpeg 未安裝。請執行：winget install --id Gyan.FFmpeg -e");
      }
      console.error(`[ffmpeg] mux FAILED:`, msg);
      throw new Error(`ffmpeg mux 失敗：${msg}`);
    }
    return outFile;
  })();
  inflightDownloads.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightDownloads.delete(key);
  }
}

/**
 * 遞迴搜尋目錄找指定檔名（不依賴 demucs model 名稱 hardcode）。
 */
function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFileRecursive(full, filename);
      if (hit) return hit;
    } else if (e.name === filename) {
      return full;
    }
  }
  return null;
}

/** demucs model 白名單；非法值 fallback htdemucs。前後端共用此正規化。 */
function safeDemucsModel(model) {
  return ["htdemucs", "htdemucs_ft", "mdx_extra_q", "mdx"].includes(model) ? model : "htdemucs";
}

/** 回傳某 videoId+model 分離後的兩軌 m4a 路徑（不保證存在）。 */
function separatedPaths(videoId, model) {
  const safeModel = safeDemucsModel(model);
  return {
    safeModel,
    outFile: path.join(CACHE_DIR, `${videoId}.nv-${safeModel}.m4a`),    // no_vocals（伴奏）
    voxFile: path.join(CACHE_DIR, `${videoId}.vox-${safeModel}.m4a`),   // vocals（人聲，導唱用）
  };
}

/**
 * demucs --two-stems=vocals 跑分離 → 輸出 no_vocals（伴奏）+ vocals（人聲）兩軌 m4a。
 * 第一次處理 3-10 分鐘（CPU；有 GPU 約 30 秒），完成後 cache 永久。
 * 回傳 no_vocals 路徑；vocals 路徑同步寫到 separatedPaths().voxFile。
 *
 * 跨平台命令探測：先試 `demucs`，找不到再試 `python -m demucs.separate`、
 * `python3 -m demucs.separate`、`py -m demucs.separate`。
 */
async function ensureSeparatedAudio(videoId, model = "htdemucs") {
  const { safeModel, outFile, voxFile } = separatedPaths(videoId, model);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    console.log(`[demucs] cache hit: ${outFile}`);
    return outFile;
  }

  const key = `${videoId}:separate:${safeModel}`;
  if (inflightDownloads.has(key)) return inflightDownloads.get(key);

  // 進度追蹤 key（前端 polling 用）
  const progKey = progressKey(videoId, safeModel);
  setProgress(progKey, {
    startTs: Date.now(),
    stage: "audio_download",
    percent: 0,
    message: "準備音訊…",
  });

  const promise = (async () => {
    // 1. 先確保有音檔 (m4a)
    console.log(`[separate] step 1/3: ensure audio for ${videoId}...`);
    const audioPath = await ensureAudioCached(videoId, "m4a");
    console.log(`[separate] audio ready at ${audioPath}`);
    setProgress(progKey, { stage: "demucs", percent: 1, message: "demucs 啟動中…" });

    // 2. 跑 demucs；嘗試多種命令直到找到能跑的
    const demucsOut = path.join(CACHE_DIR, "demucs", videoId);
    fs.mkdirSync(demucsOut, { recursive: true });

    /*
     * 加速旗標：
     *   --shifts 0     跳過 augmentation（速度 x2，品質微損）
     *   -n <model>     換更快模型（mdx_extra_q 比 htdemucs 快 3x）
     *
     * 輸出格式：
     *   --mp3 / --mp3-bitrate 320
     *
     *   為什麼用 mp3 而不是預設 wav？
     *   torchaudio 2.5+ 把儲存後端改為 torchcodec，但 Windows 上 torchcodec
     *   裝設極不穩；demucs 預設寫 wav → torchaudio.save → torchcodec → ImportError。
     *   `--mp3` 走 lameenc 路徑完全繞過 torchaudio，是目前最穩的方案。
     *
     *   需要 `lameenc` 已裝（demucs 4.0+ 列為 optional，第一次跑會提示）。
     */
    const demucsArgs = [
      "--two-stems=vocals",
      "-n", safeModel,
      "-d", demucsDevice,            // 啟動時 detectGpu() 決定 cuda/cpu（VRAM/CC 不夠就 cpu）
      "--shifts", "0",
      "--mp3", "--mp3-bitrate", "320",
      "-o", demucsOut,
      audioPath,
    ];

    const startTs = Date.now();
    console.log(`[separate] step 2/3: running demucs ${safeModel} (CPU 預估 3-8 分鐘；有 GPU 約 30 秒)...`);
    const onDemucsChunk = makeDemucsProgressParser(progKey);
    try {
      await spawnWithFallback(
        [
          { cmd: "demucs", args: demucsArgs },
          { cmd: "python", args: ["-m", "demucs.separate", ...demucsArgs] },
          { cmd: "python3", args: ["-m", "demucs.separate", ...demucsArgs] },
          { cmd: "py", args: ["-m", "demucs.separate", ...demucsArgs] },
        ],
        "demucs",
        onDemucsChunk,
      );
    } catch (e) {
      const msg = String(e?.message ?? e);
      setProgress(progKey, { stage: "error", error: msg });
      if (msg.includes("所有候選命令都不存在")) {
        throw new Error(
          "demucs 未安裝或不在 PATH。請執行：\n" +
            "  pip install demucs\n" +
            "然後重啟 backend（Ctrl+C 後重跑 npm start）"
        );
      }
      if (msg.includes("lameenc") || msg.match(/No module named ['"]lameenc/)) {
        throw new Error(
          "demucs 無法輸出 mp3 — 請執行：\n  pip install lameenc\n然後重新整理頁面再試一次。"
        );
      }
      if (msg.includes("torchcodec") || msg.match(/No module named ['"]torchcodec/)) {
        throw new Error(
          "torchaudio 缺少 torchcodec 後端（torchaudio 2.5+ 問題）。請執行二擇一：\n\n" +
            "  選項 A（推薦）：pip install lameenc\n" +
            "  選項 B：pip install \"torchaudio<2.5\"\n\n" +
            "然後重新整理頁面再試一次。"
        );
      }
      throw new Error(`demucs 執行失敗：${msg}`);
    }
    const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
    console.log(`[separate] demucs done in ${elapsed}s`);

    // 3. 找 demucs 兩軌輸出（mp3 優先）：no_vocals（伴奏）+ vocals（人聲）
    const findStem = (stem) =>
      findFileRecursive(demucsOut, `${stem}.mp3`) ||
      findFileRecursive(demucsOut, `${stem}.wav`) ||
      findFileRecursive(demucsOut, `${stem}.flac`);

    const noVocalsFile = findStem("no_vocals");
    const vocalsFile = findStem("vocals");
    if (!noVocalsFile) {
      throw new Error(`demucs 跑完但找不到 no_vocals 輸出。請檢查 ${demucsOut}。`);
    }
    console.log(`[separate] found stems: no_vocals=${!!noVocalsFile} vocals=${!!vocalsFile}`);

    // 4. ffmpeg 把兩軌都轉成 m4a（伴奏 + 人聲；人聲軌給 KTV 導唱混音用）
    console.log(`[separate] step 3/3: converting stems to m4a...`);
    setProgress(progKey, { stage: "ffmpeg_mux", percent: 95, message: "轉檔成 m4a…" });
    const toM4a = async (input, output) => {
      await spawnWithFallback(
        [{ cmd: "ffmpeg", args: ["-y", "-loglevel", "error", "-i", input, "-c:a", "aac", "-b:a", "192k", output] }],
        "ffmpeg"
      );
    };
    try {
      await toM4a(noVocalsFile, outFile);
      if (vocalsFile) {
        await toM4a(vocalsFile, voxFile);
      }
    } catch (e) {
      const msg = String(e?.message ?? e);
      setProgress(progKey, { stage: "error", error: msg });
      if (msg.includes("所有候選命令都不存在")) {
        throw new Error("ffmpeg 未安裝。請執行：winget install --id Gyan.FFmpeg -e");
      }
      throw new Error(`ffmpeg 轉檔失敗：${msg}`);
    }
    console.log(`[separate] ALL DONE: ${outFile}${vocalsFile ? " + " + voxFile : ""}`);
    setProgress(progKey, { stage: "done", percent: 100, message: "完成" });
    return outFile;
  })();
  inflightDownloads.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightDownloads.delete(key);
  }
}

// ---- Spotify 整合 -----------------------------------------------------------
//
// 使用 Client Credentials flow（不需要使用者 OAuth、只能讀公開資源 → 對「分享出去的
// 公開歌單」這個 use case 剛好）。**前置設定**：
//   1. 到 https://developer.spotify.com/dashboard 用 Spotify 帳號登入
//   2. Create App，記下 Client ID + Client Secret
//   3. 在 react_prototype/.env 或 react_prototype/server/.env 設：
//        SPOTIFY_CLIENT_ID=xxx
//        SPOTIFY_CLIENT_SECRET=xxx
//   4. 重啟 npm start
// 沒設的話 /api/spotify/* 會回 503 + 清楚的指示訊息。

let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Spotify credentials 未設定。請到 https://developer.spotify.com/dashboard 建立 App，" +
      "把 Client ID 跟 Secret 加到 react_prototype/.env：\n" +
      "  SPOTIFY_CLIENT_ID=...\n  SPOTIFY_CLIENT_SECRET=...\n然後重啟 npm start"
    );
  }
  // token 通常 3600s，提前 50s 換以避免邊界 race
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt - 50_000) {
    return spotifyTokenCache.token;
  }
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`Spotify auth 失敗 ${r.status}：${await r.text().catch(() => "")}`);
  const j = await r.json();
  spotifyTokenCache = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return spotifyTokenCache.token;
}

/** 從 spotify URL 抽 playlist ID（22 字英數）。 */
function parseSpotifyPlaylistId(url) {
  const m = String(url || "").match(/playlist\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

/** Web API 抓公開歌單（需要 Client ID/Secret + 應用擁有者要 Premium）。 */
async function fetchSpotifyPlaylistViaApi(playlistId) {
  const token = await getSpotifyToken();
  const out = [];
  let next = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&fields=items(track(name,artists(name),duration_ms)),next`;
  while (next && out.length < 200) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Spotify API ${r.status}：${await r.text().catch(() => "")}`);
    const j = await r.json();
    for (const it of j.items ?? []) {
      const t = it?.track;
      if (!t || !t.name) continue;
      out.push({
        title: t.name,
        artists: (t.artists ?? []).map((a) => a.name).filter(Boolean),
        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
      });
    }
    next = j.next;
  }
  return out;
}

/**
 * Embed 頁面爬蟲：完全不用 Spotify credentials，繞過 2024 年 11 月後
 * 「API 需要 owner Premium」的限制。
 *
 * 機制：https://open.spotify.com/embed/playlist/<id> 這個 iframe 用的頁面
 * 是 Next.js render，HTML 直接內嵌 __NEXT_DATA__ JSON 含完整 trackList。
 * 抓回來、parse、遞迴 walk 找 trackList[]、抽 title + subtitle (artist)。
 * 結構可能變，但「trackList」這個 key 很穩定（多版本都用）。
 */
async function fetchSpotifyPlaylistViaEmbed(playlistId) {
  const r = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`Spotify embed 頁面 ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) throw new Error("Spotify embed: 找不到 __NEXT_DATA__（網頁結構可能改了）");
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { throw new Error("Spotify embed JSON parse 失敗：" + e.message); }

  // 遞迴 walk 整個 tree 找第一個非空 trackList[]
  const tracks = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (Array.isArray(node.trackList) && node.trackList.length) {
      for (const t of node.trackList) {
        if (!t?.title) continue;
        const artists = t.artists?.length
          ? t.artists.map((a) => a.name).filter(Boolean)
          : (t.subtitle ? [t.subtitle] : []);
        tracks.push({
          title: t.title,
          artists,
          durationSec: Math.round((t.duration ?? 0) / 1000),
        });
      }
      return;   // 找到就停，不要繼續 walk
    }
    for (const k of Object.keys(node)) walk(node[k]);
  }
  walk(data);
  if (tracks.length === 0) throw new Error("Spotify embed: trackList 是空的（私人歌單？或網頁結構改了）");
  return tracks;
}

/**
 * 智慧路由：embed 優先（不用 credentials、繞過 Premium 政策）；失敗才退回 API。
 * 因為 2024 年 11 月後 Spotify API 強制要求 owner 是 Premium，免費 dev 帳號
 * 直接 403 — embed scraping 才是現在唯一可靠的 path。
 */
async function fetchSpotifyPlaylistTracks(playlistId) {
  let embedErr = null;
  try {
    const tracks = await fetchSpotifyPlaylistViaEmbed(playlistId);
    console.log(`[spotify] embed scraping OK：${tracks.length} 首`);
    return tracks;
  } catch (e) {
    embedErr = e;
    console.warn("[spotify] embed scraping 失敗：", e.message);
  }
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    try {
      const tracks = await fetchSpotifyPlaylistViaApi(playlistId);
      console.log(`[spotify] API fallback OK：${tracks.length} 首`);
      return tracks;
    } catch (apiErr) {
      throw new Error(
        `兩種方式都抓不到歌單：\n` +
        `  • embed: ${embedErr.message}\n` +
        `  • API:   ${apiErr.message}\n\n` +
        `建議：確認這是「公開」歌單（在 Spotify app 開 playlist → ⋯ → 分享 → 看是否「Anyone with the link」）。`
      );
    }
  }
  throw new Error(
    `Spotify embed 抓不到：${embedErr.message}\n\n` +
    `常見原因：\n` +
    `  1. 不是公開歌單 → 在 Spotify app 改成「Anyone with the link」\n` +
    `  2. Spotify 改了網頁結構（embed scraping 是 best-effort）`
  );
}

/**
 * 從 YT 搜尋找最像「歌詞影片」的那一個。評分策略：
 *   標題含 lyrics/歌詞 +5、manual CC +3、auto CC +1
 *   時長接近 spotify 給的 ±15s 內 +2
 * 沒命中就回第一個有 CC 的；連 CC 都沒有就回第一個。
 */
async function findBestYouTubeMatch(track) {
  const artist = (track.artists ?? []).join(" ");
  const query = `${artist} ${track.title} lyrics`.trim();
  const results = await ytdlpSearch(query, 6);
  if (!results.length) return null;
  function score(r) {
    let s = 0;
    const t = (r.title ?? "").toLowerCase();
    if (/lyrics?|歌詞|lyric video/i.test(t)) s += 5;
    if (r.hasManualCaptions) s += 3;
    if (r.hasAutoCaptions) s += 1;
    if (track.durationSec && r.durationSec) {
      if (Math.abs(track.durationSec - r.durationSec) < 15) s += 2;
    }
    return s;
  }
  const ranked = results.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
  return ranked[0].r;
}

// ---- Endpoints --------------------------------------------------------------

// 每個 request 在進入時印一行（讓使用者馬上知道 backend 有收到）
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[req] ${req.method} ${req.path}${req.url.includes("?") ? "?…" : ""}`);
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * 即時進度狀態（前端 polling 每秒一次）。
 *   GET /api/youtube/progress?id=<videoId>&model=<demucs_model>
 * 回 { stage, percent, modelN, totalModels, elapsedSec, message, error? }
 * 若該 key 從未開始處理，回 { stage: "idle" }。
 */
app.get("/api/youtube/progress", (req, res) => {
  const id = String(req.query.id ?? "");
  const model = String(req.query.model ?? "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  const key = progressKey(id, model);
  const state = progressMap.get(key);
  if (!state) return res.json({ stage: "idle", percent: 0 });
  res.json(state);
});

app.get("/api/youtube/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "Missing query" });
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 12)));
    const results = await ytdlpSearch(q, limit);
    res.json({ results });
  } catch (e) {
    console.error("/search failed:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/**
 * 階段 1：一次回 audio + metadata + captions（5-15 秒）。
 * 前端拿 audioUrl 設給 <audio>，就能立刻播了。
 */
app.get("/api/youtube/quick", async (req, res) => {
  try {
    const url = String(req.query.url ?? req.query.id ?? "");
    const id = /^[A-Za-z0-9_-]{11}$/.test(url) ? url : parseYouTubeId(url);
    if (!id) return res.status(400).json({ error: "Invalid YouTube URL or videoId" });

    // metadata（有 60s timeout）
    const info = await ytdlpJson(id);

    // captions 語言挑選：跟「歌曲原文」相同優先。
    //
    // 舊版錯誤地把 zh-TW manual 排第一，結果像 Lady Gaga 的英文歌會抓到
    // 「粉絲上傳的中文翻譯字幕」當大字幕用 → 完全不是歌曲原文。
    //
    // 新邏輯：detectOriginalLang(info,title) 先抓原文 → pickBestCaptionLang
    // 優先 manual 原文 > auto 原文 > 任一 manual。**完全不要 fallback 到
    // automatic_captions 的非原文版本**（那是 YT 自動翻譯，永遠爛）。
    const origLang = detectOriginalLang(info, info.title ?? id);
    const picked = pickBestCaptionLang(info, origLang);
    const captionsLang = picked?.lang ?? null;
    const captionTracks = listCaptionTracks(info, origLang);
    console.log(`[quick] ${id} origLang=${origLang} → picked=${captionsLang ?? "(無)"}${picked ? ` (${picked.source})` : ""} (共 ${captionTracks.length} 個可選)`);

    res.json({
      videoId: id,
      title: info.title ?? id,
      artist: info.artist ?? info.uploader ?? null,
      durationSec: info.duration ?? 0,
      thumbnail: info.thumbnail ?? null,
      // 前端把 audioUrl 直接設給 <audio> 即可（會觸發 backend 抽 m4a，已經 cache）
      audioUrl: `/api/youtube/stream?id=${id}&fmt=m4a`,
      videoUrl: `/api/youtube/visual?id=${id}`,
      captionsUrl: captionsLang ? `/api/youtube/captions?id=${id}&lang=${encodeURIComponent(captionsLang)}` : null,
      captionsLang,                  // 自動挑的 lang（給 UI 標記「目前選中」）
      captionTracks,                 // 全部可選 tracks，給「🔁 重挑字幕」下拉用
      instrumentalUrl: `/api/youtube/instrumental?id=${id}`,
      vocalsUrl: `/api/youtube/vocals?id=${id}`,
    });
  } catch (e) {
    console.error("/quick failed:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/**
 * 階段 2：video-only mp4（無音軌，配合 <audio> 元素同步顯示畫面）。
 */
app.get("/api/youtube/visual", async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  try {
    const file = await ensureVideoOnlyCached(id);
    const stat = fs.statSync(file);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file, { lastModified: stat.mtime, maxAge: 0 }, (err) => {
      if (err && err.code !== "ECONNABORTED" && !/aborted|ECONNRESET/i.test(err.message ?? "")) {
        console.error(`[visual] sendFile error for ${id}:`, err);
      }
    });
  } catch (e) {
    console.error(`[visual] FAILED for ${id}:`, e);
    if (!res.headersSent) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  }
});

/**
 * 階段 3：demucs 分離後的無人聲 m4a（按需，~2 分鐘）。
 */
app.get("/api/youtube/instrumental", async (req, res) => {
  const id = String(req.query.id ?? "");
  const model = String(req.query.model ?? "htdemucs");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  try {
    const file = await ensureSeparatedAudio(id, model);   // 已有的 demucs helper
    const stat = fs.statSync(file);
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file, { lastModified: stat.mtime, maxAge: 0 }, (err) => {
      if (err && err.code !== "ECONNABORTED" && !/aborted|ECONNRESET/i.test(err.message ?? "")) {
        console.error(`[instrumental] sendFile error for ${id}:`, err);
      }
    });
  } catch (e) {
    console.error(`[instrumental] FAILED for ${id}:`, e);
    const msg = String(e?.message ?? e);
    const status = /demucs (未安裝|失敗)|lameenc|torchcodec|ffmpeg/.test(msg) ? 503 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

/**
 * 階段 3b：demucs 分離後的「人聲軌」m4a（導唱混音用）。
 * 與 /instrumental 共用同一個 demucs job（ensureSeparatedAudio 同時產生兩軌），
 * 所以前端可平行打這兩個 endpoint，第二個不會再跑一次 demucs。
 *
 * 前端把 no_vocals 載到 Track-B（伴奏，gain=1），vocals 載到 Track-C
 * （人聲，gain=導唱值）→ 真・KTV 導唱（0%=純伴奏，100%=原曲）。
 */
app.get("/api/youtube/vocals", async (req, res) => {
  const id = String(req.query.id ?? "");
  const model = String(req.query.model ?? "htdemucs");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  try {
    // 確保分離完成（同一個 inflight promise，不會重跑）
    await ensureSeparatedAudio(id, model);
    const { voxFile } = separatedPaths(id, model);
    if (!fs.existsSync(voxFile) || fs.statSync(voxFile).size === 0) {
      // demucs 只輸出單軌（理論上 --two-stems 一定兩軌；防呆）
      return res.status(404).json({ error: "vocals 軌不存在（此歌可能無法分離人聲）" });
    }
    const stat = fs.statSync(voxFile);
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(voxFile, { lastModified: stat.mtime, maxAge: 0 }, (err) => {
      if (err && err.code !== "ECONNABORTED" && !/aborted|ECONNRESET/i.test(err.message ?? "")) {
        console.error(`[vocals] sendFile error for ${id}:`, err);
      }
    });
  } catch (e) {
    console.error(`[vocals] FAILED for ${id}:`, e);
    const msg = String(e?.message ?? e);
    const status = /demucs (未安裝|失敗)|lameenc|torchcodec|ffmpeg/.test(msg) ? 503 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

app.get("/api/youtube/resolve", async (req, res) => {
  try {
    const url = String(req.query.url ?? "");
    const id = parseYouTubeId(url);
    if (!id) return res.status(400).json({ error: "Invalid YouTube URL" });

    const info = await ytdlpJson(id);
    const audio = pickBestAudio(info);
    const captions = collectCaptions(info);

    res.json({
      videoId: id,
      title: info.title ?? id,
      artist: info.artist ?? info.uploader ?? null,
      durationSec: info.duration ?? 0,
      thumbnail: info.thumbnail ?? null,
      audioStream: audio
        ? {
            ext: audio.ext,
            abr: audio.abr,
            acodec: audio.acodec,
            mime: audio.ext === "webm" ? "audio/webm" : "audio/mp4",
          }
        : null,
      captions: captions.map((c) => ({ lang: c.lang, label: c.label, source: c.source })),
    });
  } catch (e) {
    console.error("/resolve failed:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/**
 * 下載到 tmp 後 sendFile：Express sendFile 自帶 HTTP Range，
 * <audio> 拖時間軸正常運作；首次抽取會等下載完。
 */
app.get("/api/youtube/stream", async (req, res) => {
  const id = String(req.query.id ?? "");
  const fmt = String(req.query.fmt ?? "m4a").toLowerCase() === "webm" ? "webm" : "m4a";

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  try {
    const file = await ensureAudioCached(id, fmt);
    const stat = fs.statSync(file);
    const mime = fmt === "webm" ? "audio/webm" : "audio/mp4";
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file, { lastModified: stat.mtime, maxAge: 0 });
  } catch (e) {
    console.error("/stream failed:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  }
});

/**
 * Muxed mp4（video+audio）— 前端用 <video> 一次播畫面+聲音，
 * 影片畫面跟 KTV 處理音訊共用 timeline，完美同步。
 *
 * `?novocals=1` 模式：回傳「視訊 + demucs 分離後 no_vocals 音軌」的 mp4。
 * 首次需 demucs 處理 1-3 分鐘，完成後 cache 永久。
 */
app.get("/api/youtube/video", async (req, res) => {
  const id = String(req.query.id ?? "");
  const noVocals = String(req.query.novocals ?? "").match(/^(1|true)$/i);
  const model = String(req.query.model ?? "htdemucs");

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  console.log(`[video] resolving for ${id} (noVocals=${!!noVocals})`);
  try {
    const file = noVocals
      ? await ensureNoVocalsVideoCached(id, model)
      : await ensureVideoCached(id);
    const stat = fs.statSync(file);
    const range = req.headers.range;
    console.log(`[video] sendFile ${file} size=${(stat.size / 1024 / 1024).toFixed(1)}MB${range ? ` range=${range}` : ""}`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file, { lastModified: stat.mtime, maxAge: 0 }, (err) => {
      if (err) {
        if (err.code === "ECONNABORTED" || /aborted|ECONNRESET/i.test(err.message ?? "")) {
          console.log(`[video] client disconnected mid-stream (normal): ${id}`);
        } else {
          console.error(`[video] sendFile error for ${id}:`, err);
        }
      } else {
        console.log(`[video] sendFile complete: ${id}`);
      }
    });
  } catch (e) {
    console.error(`[video] FAILED for ${id}:`, e);
    const msg = String(e?.message ?? e);
    const status = msg.includes("demucs 未安裝") || msg.includes("ffmpeg 未安裝") ? 503 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

/**
 * demucs ML 分離後的 no_vocals 軌。第一次需 1-3 分鐘（CPU）。
 * 若 demucs 沒裝，回 503 + 明確訊息（前端應顯示提示讓使用者裝）。
 */
app.get("/api/youtube/separate", async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: "Invalid videoId" });
  }
  try {
    const file = await ensureSeparatedAudio(id);
    const stat = fs.statSync(file);
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(file, { lastModified: stat.mtime, maxAge: 0 });
  } catch (e) {
    console.error("/separate failed:", e);
    const msg = String(e?.message ?? e);
    const status = msg.includes("demucs 未安裝") || msg.includes("ffmpeg 未安裝") ? 503 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

app.get("/api/youtube/captions", async (req, res) => {
  try {
    const id = String(req.query.id ?? "");
    const lang = String(req.query.lang ?? "zh-TW");
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return res.status(400).json({ error: "Invalid videoId" });
    }
    const info = await ytdlpJson(id);
    const subs = info?.subtitles ?? {};
    const auto = info?.automatic_captions ?? {};

    const findVttUrl = (tracks) =>
      tracks?.find((t) => t.ext === "vtt")?.url ??
      tracks?.find((t) => t.ext === "srv1" || t.ext === "ttml")?.url ??
      tracks?.[0]?.url;

    // 先試 client 指定的 lang（/quick 已經挑過原文優先了）；
    // 如果不存在，用 pickBestCaptionLang 重新挑（一樣是原文優先、不要 auto 翻譯版）
    let tracks = subs[lang] ?? auto[lang];
    if (!tracks) {
      const origLang = detectOriginalLang(info, info.title ?? id);
      const picked = pickBestCaptionLang(info, origLang);
      tracks = picked ? (picked.source === "manual" ? subs[picked.lang] : auto[picked.lang]) : undefined;
    }
    const url = findVttUrl(tracks);
    if (!url) return res.status(404).json({ error: "No captions" });

    const r = await fetch(url);
    const text = await r.text();
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.send(text);
  } catch (e) {
    console.error("/captions failed:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ---- Spotify 公開歌單匯入 ----------------------------------------------------

/**
 * 抓公開歌單的歌名列表（沒 credentials 回 503）。
 * 前端拿到後做 checkbox 給使用者勾，再 POST /api/spotify/match-yt 配對。
 */
app.get("/api/spotify/playlist", async (req, res) => {
  try {
    const url = String(req.query.url ?? "");
    const id = parseSpotifyPlaylistId(url);
    if (!id) return res.status(400).json({ error: "Invalid Spotify playlist URL（要 https://open.spotify.com/playlist/...）" });
    const tracks = await fetchSpotifyPlaylistTracks(id);
    res.json({ playlistId: id, count: tracks.length, tracks });
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.error("[spotify/playlist] FAILED:", msg);
    const status = msg.includes("credentials 未設定") ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

/**
 * 一批 spotify tracks → 每首找最佳 YT lyrics 影片。
 * Body: { tracks: [{ title, artists[], durationSec? }] }
 * Resp: { results: [{ spotifyTitle, videoId|null, title, thumbnail, hasCaptions, error? }] }
 * 平行限制 3（YT search 每個約 5-10s，太多會搶 backend CPU / 被 YT throttle）。
 */
app.post("/api/spotify/match-yt", async (req, res) => {
  try {
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks.slice(0, 30) : [];
    if (!tracks.length) return res.status(400).json({ error: "tracks 陣列為空" });
    console.log(`[spotify/match-yt] 配對 ${tracks.length} 首…`);
    const t0 = Date.now();
    const results = await mapWithLimit(tracks, 3, async (track, idx) => {
      try {
        const best = await findBestYouTubeMatch(track);
        if (!best) return { spotifyTitle: track.title, videoId: null, error: "YT 找不到結果" };
        return {
          spotifyTitle: track.title,
          spotifyArtists: track.artists ?? [],
          videoId: best.videoId,
          title: best.title,
          thumbnail: best.thumbnail,
          channel: best.channel,
          hasCaptions: !!(best.hasManualCaptions || best.hasAutoCaptions),
        };
      } catch (e) {
        return { spotifyTitle: track.title, videoId: null, error: String(e?.message ?? e) };
      }
    });
    console.log(`[spotify/match-yt] 完成 ${tracks.length} 首於 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    res.json({ results });
  } catch (e) {
    console.error("[spotify/match-yt] FAILED:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ---- 暫存檔管理 --------------------------------------------------------------

/** 看目前 cache 大小（給 SettingsPanel「清除暫存」按鈕顯示用）。 */
app.get("/api/cache/info", (_req, res) => {
  const stats = dirSize(CACHE_DIR);
  res.json({
    dir: CACHE_DIR,
    bytes: stats.bytes,
    files: stats.files,
    mb: Number((stats.bytes / 1024 / 1024).toFixed(1)),
  });
});

/** 一鍵清除（不含目前進行中的下載）。前端應該先彈確認對話框。 */
app.post("/api/cache/clear", (_req, res) => {
  const stats = clearDir(CACHE_DIR);
  console.log(`[cache] cleared ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  // 清完還是要保留資料夾本身，下次 yt-dlp 才不會抱怨找不到 outdir
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  res.json({ ok: true, cleared: stats });
});

// ---- 手機遙控（remote control）-------------------------------------------------
//
// 架構：筆電那個播放分頁是「唯一的播放權威」（單一 writer），手機只是
//   「看狀態 + 送指令」。backend 當 relay：存最後已知狀態 + 一個指令緩衝。
//   - 筆電：狀態變了就 POST /api/remote/state；每 1.2s GET /api/remote/commands 套用手機指令
//   - 手機：GET /api/remote/state 顯示；按鈕 POST /api/remote/command
// 同網域下手機開 http://<筆電區網IP>:5174/remote 直接連（與 /api 同源，無 CORS）。

let remoteState = {
  nowPlaying: null,        // { videoId, title, thumbnail } | null
  queue: [],               // [{ videoId, title, thumbnail }]
  guideVocalPercent: 30,
  paused: true,
  hqState: "off",          // demucs 狀態（顯示用）
  hqProgress: null,        // { percent, etaSec, modelN, totalModels, message } | null
  stageMode: false,        // 筆電是否在舞台/全螢幕模式
  lyricsVisible: true,     // 舞台是否顯示字幕區（手機可切）
  snapshots: [],           // 過去歌單摘要 [{ id, name, itemCount, savedTs }]，手機一鍵載入
  upcoming: [],            // 接下來歌單（前 5 首 + prefetch 狀態），舞台側欄顯示
  updatedTs: 0,
};
let remoteCommands = [];    // 手機送來、待筆電消化的指令
let remoteCmdSeq = 0;

/** 列出本機所有區網 IPv4 的遙控網址（給使用者在手機輸入 / 掃 QR）。 */
function lanRemoteUrls(port) {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      // 跳過 link-local APIPA（169.254.x.x，沒接到 DHCP 時的假位址，手機連不到）
      if (ni.family === "IPv4" && !ni.internal && !ni.address.startsWith("169.254.")) {
        urls.push(`http://${ni.address}:${port}/remote`);
      }
    }
  }
  return urls;
}

// 筆電推送目前狀態
app.post("/api/remote/state", (req, res) => {
  const b = req.body ?? {};
  remoteState = {
    nowPlaying: b.nowPlaying ?? null,
    queue: Array.isArray(b.queue) ? b.queue.slice(0, 100) : [],
    guideVocalPercent: Number.isFinite(b.guideVocalPercent) ? b.guideVocalPercent : 30,
    paused: !!b.paused,
    hqState: typeof b.hqState === "string" ? b.hqState : "off",
    hqProgress: b.hqProgress && typeof b.hqProgress === "object" ? b.hqProgress : null,
    stageMode: !!b.stageMode,
    lyricsVisible: b.lyricsVisible !== false,   // 預設 true，明確傳 false 才隱藏
    snapshots: Array.isArray(b.snapshots) ? b.snapshots.slice(0, 30) : [],
    upcoming: Array.isArray(b.upcoming) ? b.upcoming.slice(0, 10) : [],
    updatedTs: Date.now(),
  };
  res.json({ ok: true });
});

// 手機讀狀態
app.get("/api/remote/state", (_req, res) => {
  res.json(remoteState);
});

// 手機送指令
app.post("/api/remote/command", (req, res) => {
  const b = req.body ?? {};
  if (!b.type) return res.status(400).json({ error: "missing command type" });
  const cmd = { id: ++remoteCmdSeq, ts: Date.now(), ...b };
  remoteCommands.push(cmd);
  if (remoteCommands.length > 50) remoteCommands = remoteCommands.slice(-50);  // 防爆
  console.log(`[remote] command #${cmd.id} ${cmd.type}`, cmd.value ?? cmd.item?.title ?? cmd.index ?? "");
  res.json({ ok: true, id: cmd.id });
});

// 筆電 poll 待處理指令（取走即清空）
app.get("/api/remote/commands", (_req, res) => {
  const out = remoteCommands;
  remoteCommands = [];
  res.json({ commands: out });
});

// 遙控網址資訊（筆電 UI 顯示 QR / URL 用）
app.get("/api/remote/info", (_req, res) => {
  res.json({ port: PORT, urls: lanRemoteUrls(PORT) });
});

// 手機遙控頁（純靜態 HTML，同源呼叫 /api/...）
app.get("/remote", (_req, res) => {
  res.sendFile(path.join(__dirname, "remote.html"), (err) => {
    if (err && !res.headersSent) res.status(500).send("remote.html not found");
  });
});

/**
 * GPU 自動偵測 + 算力門檻判斷。
 *
 * 為什麼不無腦 `-d cuda`：demucs 預設會自動用 CUDA，但若 GPU VRAM 不夠（htdemucs
 * 推論需 ~2GB，bag-of-4 模型需 ~6GB），會 OOM crash 或極慢；compute capability
 * 太舊（<5.0 Maxwell 以下）也只能勉強跑。發現以上情況就強制走 CPU（穩，慢一點）。
 *
 * 門檻：VRAM >= 3GB 且 CC >= 5.0 → cuda，否則 cpu。
 * 結果存到 module-level `demucsDevice`，ensureSeparatedAudio 用 `-d <device>` 強制指定。
 */
let demucsDevice = "cpu";   // 預設保守值（偵測完成前 / 偵測失敗都走 cpu）
let gpuInfo = { detected: false, device: "cpu", name: "(unknown)", vramGb: 0, cc: 0, reason: "preset" };

async function detectGpu() {
  const pyCode = [
    "import torch",
    "ok = torch.cuda.is_available()",
    "print('CUDA', ok)",
    "if ok:",
    "    p = torch.cuda.get_device_properties(0)",
    "    print('DEV', p.name)",
    "    print('VRAM', '%.2f' % (p.total_memory / (1024**3)))",
    "    print('CC', '%d.%d' % (p.major, p.minor))",
    "else:",
    "    print('DEV cpu')",
  ].join("\n");
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const { stdout } = await execFile(cmd, ["-c", pyCode], { timeout: 25_000 });
      const cuda = /CUDA True/.test(stdout);
      const dev = stdout.match(/DEV (.+)/)?.[1]?.trim() ?? "cpu";
      const vram = Number(stdout.match(/VRAM ([\d.]+)/)?.[1] ?? 0);
      const ccStr = stdout.match(/CC ([\d.]+)/)?.[1] ?? "0";
      const ccMajor = Number(ccStr.split(".")[0] || 0);

      gpuInfo = { detected: true, name: dev, vramGb: vram, cc: Number(ccStr), reason: "", device: "cpu" };

      if (!cuda) {
        console.log("[gpu] ⚠️  未偵測到 CUDA GPU → demucs 走 CPU（每首 1-8 分鐘）。");
        console.log("[gpu]     有 NVIDIA 卡可裝 CUDA 版 PyTorch 大幅加速：");
        console.log("[gpu]     pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121");
        gpuInfo.reason = "no_cuda";
      } else if (vram < 3.0) {
        console.log(`[gpu] ⚠️  ${dev} VRAM 只有 ${vram.toFixed(1)}GB（htdemucs 推論需 ~2GB，bag-of-4 需 ~6GB）`);
        console.log(`[gpu]     → 改走 CPU，避免 OOM / swap thrash。`);
        gpuInfo.reason = `low_vram(${vram.toFixed(1)}GB)`;
      } else if (ccMajor < 5) {
        console.log(`[gpu] ⚠️  ${dev} compute capability ${ccStr} 太舊（< 5.0 Maxwell）→ 改走 CPU。`);
        gpuInfo.reason = `old_cc(${ccStr})`;
      } else {
        demucsDevice = "cuda";
        gpuInfo.device = "cuda";
        gpuInfo.reason = "ok";
        console.log(`[gpu] ✅ ${dev} VRAM ${vram.toFixed(1)}GB CC ${ccStr} → 用 CUDA 加速 demucs（10-30 秒/首）`);
      }
      return;
    } catch {
      /* 試下一個 python 命令 */
    }
  }
  gpuInfo.reason = "no_python_or_torch";
  console.log("[gpu] (略過 GPU 偵測：找不到 python，或 torch 未安裝) → 走 CPU");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Karaoke backend listening on http://localhost:${PORT}`);
  console.log("Cache dir:", CACHE_DIR);
  const urls = lanRemoteUrls(PORT);
  if (urls.length) {
    console.log("📱 手機遙控（同一個 WiFi 下，手機瀏覽器開）：");
    for (const u of urls) console.log("   " + u);
  } else {
    console.log("📱 手機遙控：找不到區網 IP（沒連到網路？）");
  }
  detectGpu();   // 非同步，偵測完才印（不阻塞啟動）
  console.log("Endpoints:");
  console.log("  GET /api/health");
  console.log("  GET /api/youtube/resolve?url=<youtube_url>");
  console.log("  GET /api/youtube/stream?id=<video_id>&fmt=m4a|webm");
  console.log("  GET /api/youtube/quick?url=<url>              ★ 階段 1：audio + metadata + captions（即播）");
  console.log("  GET /api/youtube/visual?id=<video_id>         ★ 階段 2：video-only mp4（背景下載）");
  console.log("  GET /api/youtube/instrumental?id=<id>&model=Y ★ 階段 3：demucs 伴奏 m4a（no_vocals）");
  console.log("  GET /api/youtube/vocals?id=<id>&model=Y       ★ 階段 3b：demucs 人聲 m4a（vocals，導唱用）");
  console.log("  GET /api/youtube/video?id=<video_id>          (legacy muxed mp4)");
  console.log("  GET /api/youtube/separate?id=<video_id>       (legacy demucs)");
  console.log("  GET /api/youtube/progress?id=<id>&model=<m>   (即時進度，前端 polling)");
  console.log("  GET /api/youtube/captions?id=<video_id>&lang=zh-TW");
  console.log("  GET /remote                                   ★ 手機遙控頁");
  console.log("  GET /api/remote/state | /info                 (遙控狀態 / 網址)");
});
