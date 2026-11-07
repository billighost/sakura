import { createHash } from "node:crypto";

export interface LyricIdentity {
  recordingId?: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  language?: "ja" | "ko" | "zh" | "en" | string;
}

export interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export type LyricMatch =
  | { status: "matched"; track: LrcLibTrack; provider: "lrclib" }
  | { status: "missing" | "ambiguous" | "unavailable"; reason: string };

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
const hasJapanese = (text: string) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);

/** Fail closed rather than picking the highest-scoring unrelated lyric. */
export function selectLyricsCandidate(identity: LyricIdentity, candidates: readonly LrcLibTrack[]): LyricMatch {
  if (!identity.title.trim() || !identity.artist.trim()) return { status: "missing", reason: "Title and artist are required" };
  if (identity.durationSeconds !== undefined && (!Number.isFinite(identity.durationSeconds) || identity.durationSeconds <= 0)) {
    return { status: "missing", reason: "Recording duration must be a positive finite number" };
  }
  const compatible = candidates.filter((candidate) => {
    if (!candidate || typeof candidate.trackName !== "string" || typeof candidate.artistName !== "string" || !Number.isFinite(candidate.id)) return false;
    if (normalize(candidate.trackName) !== normalize(identity.title) || normalize(candidate.artistName) !== normalize(identity.artist)) return false;
    if (!candidate.plainLyrics && !candidate.syncedLyrics && !candidate.instrumental) return false;
    if (identity.language === "ja" && !candidate.instrumental && !hasJapanese(candidate.plainLyrics || "") && !hasJapanese(candidate.syncedLyrics || "")) return false;
    if (identity.durationSeconds !== undefined) {
      if (candidate.duration === undefined || !Number.isFinite(candidate.duration)) return false;
      if (Math.abs(candidate.duration - identity.durationSeconds) > Math.min(4, Math.max(2, identity.durationSeconds * 0.02))) return false;
    }
    return true;
  }).map((candidate) => identity.language === "ja" && !candidate.instrumental ? {
    ...candidate,
    // A provider can pair Japanese synced text with a translated plain field.
    // Keep only Japanese-bearing representations instead of merging them.
    plainLyrics: hasJapanese(candidate.plainLyrics || "") ? candidate.plainLyrics : null,
    syncedLyrics: hasJapanese(candidate.syncedLyrics || "") ? candidate.syncedLyrics : null,
  } : candidate);
  if (!compatible.length) return { status: "missing", reason: "No verified title, artist, language and duration match" };
  const exactAlbum = identity.album ? compatible.filter((candidate) => normalize(candidate.albumName || "") === normalize(identity.album!)) : [];
  const pool = exactAlbum.length ? exactAlbum : compatible;
  pool.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) || a.id - b.id);
  // Without duration/album metadata, editions with materially different lengths
  // cannot be confidently treated as the requested recording.
  const durations = pool.map((candidate) => candidate.duration).filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (identity.durationSeconds === undefined && !exactAlbum.length && durations.length > 1 && Math.max(...durations) - Math.min(...durations) > 4) {
    return { status: "ambiguous", reason: "Multiple editions have different durations; recording metadata is required" };
  }
  return { status: "matched", track: pool[0], provider: "lrclib" };
}

export function lyricCacheKey(identity: LyricIdentity) {
  const digest = createHash("sha256").update(JSON.stringify({
    title: normalize(identity.title), artist: normalize(identity.artist), album: normalize(identity.album || ""),
    duration: identity.durationSeconds ?? null, language: identity.language ?? null,
  })).digest("hex");
  return `lyrics:verified-v1:${identity.recordingId || "adhoc"}:${digest}`;
}

/** The exact source can answer immediately; slow unrelated sources cannot hold it up. */
export async function fetchLrcLibLyrics(identity: LyricIdentity, options: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<LyricMatch> {
  const fetcher = options.fetch || fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 6000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const query = new URLSearchParams({ track_name: identity.title, artist_name: identity.artist });
  if (identity.album) query.set("album_name", identity.album);
  if (identity.durationSeconds !== undefined) query.set("duration", String(identity.durationSeconds));
  const headers = { "User-Agent": "Sakura/2.0 (https://github.com/billighost/sakura)" };
  try {
    const direct = await fetcher(`https://lrclib.net/api/get?${query}`, { signal, headers });
    if (direct.ok) {
      const data = await direct.json() as LrcLibTrack;
      const match = selectLyricsCandidate(identity, [data]);
      if (match.status === "matched") return match;
    } else if (direct.status !== 404) return { status: "unavailable", reason: `LRCLib HTTP ${direct.status}` };
    const search = new URLSearchParams({ track_name: identity.title, artist_name: identity.artist });
    const response = await fetcher(`https://lrclib.net/api/search?${search}`, { signal, headers });
    if (!response.ok) return { status: "unavailable", reason: `LRCLib HTTP ${response.status}` };
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return { status: "unavailable", reason: "Invalid provider response" };
    return selectLyricsCandidate(identity, data as LrcLibTrack[]);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: "unavailable", reason: signal.aborted ? "Lyrics provider timed out" : "Lyrics provider could not be reached" };
  }
}
