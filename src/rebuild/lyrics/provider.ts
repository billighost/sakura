import { createHash } from "node:crypto";
import { JAPANESE_LYRIC_CORPUS } from "./corpus";

export interface LyricIdentity {
  recordingId?: string;
  title: string;
  artist: string;
  artists?: readonly string[];
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
const unique = (values: readonly (string | undefined)[]) => [...new Map(values.filter((value): value is string => Boolean(value?.trim())).map(value => [normalize(value), value.trim()])).values()];
const artistParts = (value: string) => unique(value.split(/\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+|\s*[,&]\s*/i));

export function lyricIdentityVariants(identity: LyricIdentity) {
  const artists = unique([identity.artist, ...(identity.artists || [])]);
  const corpus = JAPANESE_LYRIC_CORPUS.find(song =>
    song.titles.some(title => normalize(title) === normalize(identity.title)) &&
    song.artists.some(artist => artists.some(value => normalize(value) === normalize(artist))));
  return { titles: unique([identity.title, ...(corpus?.titles || [])]), artists: unique([...artists, ...(corpus?.artists || [])]) };
}

/** Fail closed rather than picking the highest-scoring unrelated lyric. */
export function selectLyricsCandidate(identity: LyricIdentity, candidates: readonly LrcLibTrack[]): LyricMatch {
  if (!identity.title.trim() || !identity.artist.trim()) return { status: "missing", reason: "Title and artist are required" };
  if (identity.durationSeconds !== undefined && (!Number.isFinite(identity.durationSeconds) || identity.durationSeconds <= 0)) {
    return { status: "missing", reason: "Recording duration must be a positive finite number" };
  }
  const variants = lyricIdentityVariants(identity);
  const compatible = candidates.filter((candidate) => {
    if (!candidate || typeof candidate.trackName !== "string" || typeof candidate.artistName !== "string" || !Number.isFinite(candidate.id)) return false;
    if (!variants.titles.some(title => normalize(candidate.trackName) === normalize(title))) return false;
    const candidateArtists = unique([candidate.artistName, ...artistParts(candidate.artistName)]);
    if (!candidateArtists.some(candidateArtist => variants.artists.some(artist => normalize(candidateArtist) === normalize(artist)))) return false;
    if (!candidate.plainLyrics && !candidate.syncedLyrics && !candidate.instrumental) return false;
    if (identity.language === "ja" && !candidate.instrumental && !hasJapanese(candidate.plainLyrics || "") && !hasJapanese(candidate.syncedLyrics || "")) return false;
    if (identity.durationSeconds !== undefined) {
      if (candidate.duration === undefined || !Number.isFinite(candidate.duration)) return false;
      if (Math.abs(candidate.duration - identity.durationSeconds) > Math.min(6, Math.max(3, identity.durationSeconds * 0.025))) return false;
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
  const pool = [...(exactAlbum.length ? exactAlbum : compatible)];
  pool.sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)) ||
    Math.abs((a.duration ?? identity.durationSeconds ?? 0) - (identity.durationSeconds ?? a.duration ?? 0)) - Math.abs((b.duration ?? identity.durationSeconds ?? 0) - (identity.durationSeconds ?? b.duration ?? 0)) || a.id - b.id);
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
    artists: unique(identity.artists || []).map(normalize).sort(), duration: identity.durationSeconds ?? null, language: identity.language ?? null,
  })).digest("hex");
  return `lyrics:verified-v1:${identity.recordingId || "adhoc"}:${digest}`;
}

/** The exact source can answer immediately; slow unrelated sources cannot hold it up. */
export async function fetchLrcLibLyrics(identity: LyricIdentity, options: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<LyricMatch> {
  const fetcher = options.fetch || fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 6000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers = { "User-Agent": "Sakura/2.0 (https://github.com/billighost/sakura)" };
  try {
    const variants = lyricIdentityVariants(identity);
    const pairs = unique(variants.titles.flatMap(title => variants.artists.slice(0, 3).map(artist => `${title}\0${artist}`))).slice(0, 8).map(value => value.split("\0") as [string, string]);
    const candidates: LrcLibTrack[] = [];
    let successful = false;
    let lastFailure = "Lyrics provider could not be reached";
    const load = async (url: string) => {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetcher(url, { signal, headers });
        if (response.ok || response.status === 404 || (response.status < 500 && response.status !== 429)) break;
        lastFailure = `LRCLib HTTP ${response.status}`;
        if (attempt === 0) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 90);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
      }
      if (!response) return undefined;
      if (response.status === 404) { successful = true; return undefined; }
      if (!response.ok) { lastFailure = `LRCLib HTTP ${response.status}`; return undefined; }
      successful = true;
      return response.json() as Promise<unknown>;
    };
    for (const [title, artist] of pairs) {
      const query = new URLSearchParams({ track_name: title, artist_name: artist });
      if (identity.album) query.set("album_name", identity.album);
      if (identity.durationSeconds !== undefined) query.set("duration", String(identity.durationSeconds));
      const data = await load(`https://lrclib.net/api/get?${query}`);
      if (data && !Array.isArray(data)) {
        const match = selectLyricsCandidate(identity, [data as LrcLibTrack]);
        if (match.status === "matched") return match;
      }
    }
    for (const [title, artist] of pairs.slice(0, 5)) {
      const query = new URLSearchParams({ track_name: title, artist_name: artist });
      const data = await load(`https://lrclib.net/api/search?${query}`);
      if (Array.isArray(data)) candidates.push(...data as LrcLibTrack[]);
      const match = selectLyricsCandidate(identity, candidates);
      if (match.status === "matched") return match;
    }
    const broad = new URLSearchParams({ q: `${identity.title} ${identity.artist}` });
    const broadData = await load(`https://lrclib.net/api/search?${broad}`);
    if (Array.isArray(broadData)) candidates.push(...broadData as LrcLibTrack[]);
    const selected = selectLyricsCandidate(identity, candidates);
    return selected.status !== "missing" || successful ? selected : { status: "unavailable", reason: lastFailure };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { status: "unavailable", reason: signal.aborted ? "Lyrics provider timed out" : "Lyrics provider could not be reached" };
  }
}
