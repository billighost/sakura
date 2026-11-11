import type { TimedLyric } from "./parse";

export interface AutoSyncEvidence {
  engine: string;
  audioSha256: string;
  confidence: number;
  elapsedMs: number;
  sourceContentKey: string;
}

function normalizedEnglish(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’‘]/g,"'").toUpperCase();
}
export function canAutoSync(lines: readonly Pick<TimedLyric,"text">[], language?: string) {
  if (language && !/^en(?:-|$)/i.test(language)) return false;
  const text = lines.map(line => normalizedEnglish(line.text)).join(" ");
  // This model only understands English. Other scripts and numbers must not be
  // silently discarded to produce plausible-looking but false timestamps.
  return text.length <= 10_000 && /[A-Z]/.test(text) && !/[^A-Z'♪♫♬\p{P}\p{Z}\s]/u.test(text)
    && lines.length <= 400;
}
