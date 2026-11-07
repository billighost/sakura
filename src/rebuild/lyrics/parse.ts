export interface TimedWord { text: string; start: number; end?: number }
export interface TimedLyric { text: string; start: number; end?: number; words?: TimedWord[] }

const LINE_TAG = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d+):(\d{2})(?:[.:](\d{1,3}))?>/g;
const seconds = (minutes: string, secs: string, fraction = "") =>
  Number(minutes) * 60 + Number(secs) + Number(fraction.padEnd(3, "0")) / 1000;

/** LRC offsets, repeated timestamps and instrumental blank lines are meaningful. */
export function parseTimedLyrics(lrc: string): TimedLyric[] {
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(lrc)?.[1] || 0) / 1000;
  const result: TimedLyric[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LINE_TAG)];
    if (!stamps.length) continue;
    const last = stamps[stamps.length - 1];
    const body = raw.slice((last.index || 0) + last[0].length);
    const marks = [...body.matchAll(WORD_TAG)];
    const words: TimedWord[] = marks.map((mark, index) => ({
      start: Math.max(0, seconds(mark[1], mark[2], mark[3]) + offset),
      text: body.slice((mark.index || 0) + mark[0].length, marks[index + 1]?.index ?? body.length),
    })).filter((word) => word.text.trim());
    for (let index = 0; index < words.length - 1; index++) words[index].end = words[index + 1].start;
    for (const stamp of stamps) {
      const start = Math.max(0, seconds(stamp[1], stamp[2], stamp[3]) + offset);
      // Word tags have absolute timestamps and cannot be copied to a repeat.
      const ownWords = stamps.length === 1 && words.length ? words : undefined;
      result.push({ start, text: body.replace(WORD_TAG, "").trim(), ...(ownWords ? { words: ownWords } : {}) });
    }
  }
  result.sort((a, b) => a.start - b.start);
  for (let index = 0; index < result.length; index++) {
    const nextStart = result.slice(index + 1).find((line) => line.start > result[index].start)?.start;
    if (nextStart !== undefined) result[index].end = nextStart;
    const words = result[index].words;
    if (words?.length && nextStart !== undefined) words[words.length - 1].end = nextStart;
  }
  return result;
}

/** Text and time must agree before borrowing another provider's word timings. */
export function mergeVerifiedWordTimings(lines: readonly TimedLyric[], wordLines: readonly TimedLyric[], tolerance = 0.6) {
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
  return lines.map((line) => {
    const match = wordLines.find((other) => other.words?.length && Math.abs(other.start - line.start) <= tolerance &&
      normalize(other.text) === normalize(line.text));
    return match ? { ...line, words: match.words?.map((word) => ({ ...word })) } : { ...line };
  });
}

export function activeLyricIndex(lines: readonly TimedLyric[], position: number) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start <= position) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (found < 0 || !lines[found].text || (lines[found].end !== undefined && position >= lines[found].end!)) return -1;
  return found;
}
