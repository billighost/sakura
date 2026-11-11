import { parseTimedLyrics, type TimedLyric } from "../lyrics/parse";

export type LyricFormat = "plain" | "lrc";
export function lyricStudioLines(text: string, format: LyricFormat): string[] {
  if (format === "lrc" && !lyricStudioError(text, format, 0)) return parseTimedLyrics(text).map(line => line.text.trim()).filter(Boolean);
  // A partial imported LRC can be repaired by tap timing. Keep its unstamped
  // words instead of accepting only the lines a permissive parser recognized.
  return text.replace(/\r\n?/g, "\n").split("\n").filter(line => format !== "lrc" || !/^\s*\[(?:ar|al|ti|by|re|ve|length|offset):[^\]]*\]\s*$/i.test(line)).map(line => (format === "lrc" ? line.replace(/^\s*(?:\[\d+:[^\]]*\])+/, "").replace(/<\d+:[^>]*>/g, "") : line).trim()).filter(Boolean);
}
export function lrcTimestamp(seconds: number) {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  return `[${String(Math.floor(hundredths / 6000)).padStart(2, "0")}:${String(Math.floor(hundredths / 100) % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}]`;
}
export function timedStudioText(lines: readonly string[], times: readonly (number | null)[]) {
  return lines.map((line, index) => times[index] === null || times[index] === undefined ? null : `${lrcTimestamp(times[index]!)}${line}`).filter((line): line is string => line !== null).join("\n");
}
/** A tap cannot replace another line or conceal a backwards playback seek. */
export function stampStudioLine(times: readonly (number | null)[], index: number, positionMs: number): (number | null)[] | undefined {
  if (index !== times.findIndex(time => time === null) || !Number.isFinite(positionMs) || positionMs < 0) return;
  const time = Math.round(positionMs / 10) / 100, previous = index ? times[index - 1] : null;
  if (previous !== null && previous !== undefined && time < previous) return;
  const next = times.slice(index + 1).find(value => value !== null);
  if (next !== undefined && next !== null && time > next) return;
  return times.map((prior, at) => at === index ? time : prior);
}
export function lyricStudioError(text: string, format: LyricFormat, durationMs: number): string | undefined {
  if (!text.trim()) return "Add the words to this song first.";
  if (text.length > 20000 || text.split(/\r?\n/).length > 400) return "Keep lyrics under 400 lines and 20,000 characters.";
  if (format !== "lrc") return;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*\[(?:ar|al|ti|by|re|ve|length|offset):[^\]]*\]\s*$/i.test(line)) continue;
    const tags = line.match(/^\s*((?:\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\])+)/);
    if (!tags || /^\s*\[\d/.test(line.slice(tags[0].length))) return "Give every lyric line a complete timestamp, such as [00:12.50]. You can use Tap timing to add them.";
    const body = line.slice(tags[0].length);
    if ((body.match(/<\d+:[^>]*(?:>|$)/g) || []).some(tag => !/^<\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?>$/.test(tag))) return "A word timestamp is incomplete or has invalid seconds. Use a complete time, such as <00:12.50>.";
  }
  const lines = parseTimedLyrics(text);
  if (!lines.some(line => line.text.trim())) return "Add at least one lyric line with a timestamp.";
  if (durationMs > 0 && lines.some(line => line.start * 1000 > durationMs + 2000)) return "A timestamp goes beyond this song. Adjust it before publishing.";
  for (const line of lines) {
    const words = line.words || [];
    if (words.some((word, index) => word.start < line.start || index > 0 && word.start < words[index - 1].start || line.end !== undefined && word.start > line.end || durationMs > 0 && word.start * 1000 > durationMs + 2000)) return "Word timestamps must move forward within their lyric line and this song. Adjust them before publishing.";
  }
}
export function studioPreview(text: string, format: LyricFormat): TimedLyric[] {
  return format === "lrc" ? parseTimedLyrics(text) : lyricStudioLines(text, format).map(line => ({ text: line, start: 0 }));
}

export interface LyricStudioDraft { text: string; format: LyricFormat; lines: string[]; times: (number | null)[]; savedAt: number }
export function recoverStudioTiming(text: string, format: LyricFormat, draft?: Pick<LyricStudioDraft, "lines" | "times">) {
  const lines = lyricStudioLines(text, format);
  const matches = Boolean(draft && draft.times.length === lines.length && draft.lines.length === lines.length && draft.lines.every((line, index) => line === lines[index]));
  const embedded = draft && draft.lines.length === 0 && format === "lrc" && !lyricStudioError(text, format, 0) ? parseTimedLyrics(text).filter(line => line.text.trim()).map(line => line.start) : undefined;
  const times = matches ? [...draft!.times] : embedded || lines.map(() => null);
  const complete = lines.length > 0 && times.every(time => time !== null);
  const next = times.findIndex(time => time === null);
  const last = (next >= 0 ? times.slice(0, next) : times).findLast(time => time !== null);
  return { lines, times, complete, positionMs: Math.max(0, (last || 0) * 1000 - 1500) };
}
export function readStudioDraft(key: string): LyricStudioDraft | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null") as LyricStudioDraft | null;
    if (!raw || typeof raw.text !== "string" || raw.text.length > 20000 || !["plain", "lrc"].includes(raw.format) || !Array.isArray(raw.lines) || raw.lines.length > 400 || !raw.lines.every(line => typeof line === "string") || !Array.isArray(raw.times) || raw.times.length !== raw.lines.length || !raw.times.every(time => time === null || typeof time === "number" && Number.isFinite(time) && time >= 0) || !Number.isFinite(raw.savedAt)) return;
    if (raw.times.some((time, index) => time !== null && index > 0 && raw.times[index - 1] !== null && time < raw.times[index - 1]!)) return;
    return raw;
  } catch { return; }
}
