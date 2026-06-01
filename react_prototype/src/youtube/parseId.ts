/** 統一的 YouTube URL / 純 ID 解析工具，避免散落各處重複實作。 */
export function parseYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // 純 ID（11 字元）
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("embed");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function isYouTubeUrl(input: string | null | undefined): boolean {
  return parseYouTubeId(input) !== null;
}
