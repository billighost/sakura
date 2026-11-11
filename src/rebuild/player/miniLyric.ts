import { activeLyricIndex, type TimedLyric } from "../lyrics/parse";

/** A subtitle is only visible inside its verified timing, including silent gaps. */
export function miniLyricCue(lines: readonly (TimedLyric & { romanized?: string })[], positionMs: number) {
  if (!Number.isFinite(positionMs) || positionMs < 0) return null;
  const index = activeLyricIndex(lines, positionMs / 1000);
  if (index < 0) return null;
  const start = lines[index].start;
  let first = index;
  while (first > 0 && lines[first - 1].start === start) first--;
  const visible = lines.slice(first, index + 1)
    .filter(line => line.text.trim() && (line.end === undefined || positionMs / 1000 < line.end));
  const text = visible.map(line => line.text.trim()).join(" · ");
  const romanized = visible.some(line => line.romanized?.trim() && line.romanized.trim() !== line.text.trim())
    ? visible.map(line => line.romanized?.trim()).filter(Boolean).join(" · ") : undefined;
  return text ? { text, start, index, ...(romanized ? { romanized } : {}) } : null;
}
