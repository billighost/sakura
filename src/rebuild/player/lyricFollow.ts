import type { TimedLyric } from "../lyrics/parse";

export interface LyricViewport { top: number; bottom: number }

/** Keep the reading position above the transport, including on narrow phones. */
export function lyricReadingViewport(viewport: LyricViewport, controls?: LyricViewport | null): LyricViewport {
  const bottom = controls && controls.top > viewport.top && controls.top < viewport.bottom
    ? controls.top : viewport.bottom;
  return { top: viewport.top + 12, bottom: Math.max(viewport.top + 12, bottom - 12) };
}

/** Long verses rejoin when their centre is visible, rather than requiring the entire verse to fit. */
export function lyricIsInView(line: LyricViewport, viewport: LyricViewport) {
  if (viewport.bottom <= viewport.top || line.bottom <= line.top) return false;
  const visible = Math.min(line.bottom, viewport.bottom) - Math.max(line.top, viewport.top);
  return visible > 0 && (line.top + line.bottom) / 2 >= viewport.top && (line.top + line.bottom) / 2 <= viewport.bottom;
}

export function lyricScrollTarget(scrollTop: number, line: LyricViewport, viewport: LyricViewport) {
  const readingPoint = viewport.top + (viewport.bottom - viewport.top) * .4;
  return Math.max(0, scrollTop + (line.top + line.bottom) / 2 - readingPoint);
}

/** Blank timestamps mark a musical interlude and need a scroll anchor of their own. */
export function lyricMoment(lines: readonly TimedLyric[], position: number): { index: number; kind: "empty" | "intro" | "line" | "interlude" | "outro" } {
  if (!lines.length || !Number.isFinite(position)) return { index: -1, kind: "empty" };
  if (position < lines[0].start) return { index: 0, kind: "intro" };
  let low = 0, high = lines.length - 1, index = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start <= position) { index = middle; low = middle + 1; }
    else high = middle - 1;
  }
  const line = lines[index];
  if (line.end !== undefined && position >= line.end) return { index, kind: index === lines.length - 1 ? "outro" : "interlude" };
  return { index, kind: line.text.trim() ? "line" : "interlude" };
}
