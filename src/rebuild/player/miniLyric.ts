import { activeLyricIndex, type TimedLyric } from "../lyrics/parse";

/** A subtitle is only visible inside its verified timing, including silent gaps. */
export function miniLyricCue(lines: readonly TimedLyric[], positionMs: number) {
  if (!Number.isFinite(positionMs) || positionMs < 0) return null;
  const index = activeLyricIndex(lines, positionMs / 1000);
  if (index < 0) return null;
  const start = lines[index].start;
  let first = index;
  while (first > 0 && lines[first - 1].start === start) first--;
  const text = lines.slice(first, index + 1)
    .filter(line => line.text.trim() && (line.end === undefined || positionMs / 1000 < line.end))
    .map(line => line.text.trim()).join(" · ");
  return text ? { text, start, index } : null;
}
