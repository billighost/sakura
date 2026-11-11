import { createHash } from "node:crypto";
import { JAPANESE_LYRIC_CORPUS } from "./corpus";
import { parseTimedLyrics } from "./parse";
import { createLyricTransport, type LyricProviderOptions, type LyricResponse } from "./transport";
import { lyricArtistParts, lyricEdition, lyricText, lyricTitleVariants } from "./identity";

export interface LyricIdentity {
  recordingId?: string;
  title: string;
  artist: string;
  artists?: readonly string[];
  album?: string;
  durationSeconds?: number;
  language?: "ja" | "ko" | "zh" | "en" | string;
  alternateTitles?: readonly string[];
  versionLabel?: string;
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
  | { status: "matched"; track: LrcLibTrack; provider: "lrclib" | "netease" | "lyrica" | "lyrics.ovh" }
  | { status: "missing" | "ambiguous" | "unavailable"; reason: string; retryAfterMs?: number };

const normalize = lyricText;
const hasJapanese = (text: string) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
const unique = (values: readonly (string | undefined)[]) => [...new Map(values.filter((value): value is string => Boolean(value?.trim())).map(value => [normalize(value), value.trim()])).values()];


export function lyricIdentityVariants(identity: LyricIdentity) {
  const artists = unique([identity.artist, ...lyricArtistParts(identity.artist), ...(identity.artists || []).flatMap(artist => [artist, ...lyricArtistParts(artist)])]);
  const corpus = JAPANESE_LYRIC_CORPUS.find(song =>
    song.titles.some(title => normalize(title) === normalize(identity.title)) &&
    song.artists.some(artist => artists.some(value => normalize(value) === normalize(artist))));
  return { titles: unique([...lyricTitleVariants(identity.title), ...(identity.alternateTitles || []), ...(corpus?.titles || [])]), artists: unique([...artists, ...(corpus?.artists || [])]) };
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
    if (JSON.stringify(lyricEdition(identity.title,identity.versionLabel)) !== JSON.stringify(lyricEdition(candidate.trackName))) return false;
    if (!lyricEdition(identity.title).includes("live") && /\blive\s+(?:\d{4}|at|in|from)\b/i.test(candidate.albumName || "")) return false;
    if (lyricEdition(identity.title,identity.versionLabel).includes("instrumental") && (!candidate.instrumental || candidate.plainLyrics?.trim() || candidate.syncedLyrics?.trim())) return false;
    if (!variants.titles.some(title => lyricTitleVariants(candidate.trackName).some(name => normalize(name) === normalize(title)))) return false;
    const candidateArtists = unique([candidate.artistName, ...lyricArtistParts(candidate.artistName)]);
    if (!candidateArtists.some(candidateArtist => variants.artists.some(artist => normalize(candidateArtist) === normalize(artist)))) return false;
    if (!candidate.plainLyrics?.trim() && !candidate.syncedLyrics?.trim() && !candidate.instrumental) return false;
    if (candidate.syncedLyrics && !candidate.plainLyrics?.trim() && !candidate.instrumental && !parseTimedLyrics(candidate.syncedLyrics).some(line => line.text)) return false;
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
    alternateTitles: identity.alternateTitles || [], versionLabel: identity.versionLabel || "",
  })).digest("hex");
  return `lyrics:verified-v3:${identity.recordingId || "adhoc"}:${digest}`;
}

/** Exact lookup stays fast; every remaining alias/search can independently recover a failed lookup. */
export async function fetchLrcLibLyrics(identity: LyricIdentity, options: LyricProviderOptions = {}): Promise<LyricMatch> {
  const transport = createLyricTransport(options, "LRCLib");
  const variants = lyricIdentityVariants(identity);
  const pairs = unique(variants.titles.slice(0, 4).flatMap(title => variants.artists.slice(0, 8).map(artist => `${title}\0${artist}`))).slice(0, 16).map(value => value.split("\0") as [string, string]);
  const candidates: LrcLibTrack[] = [];
  const failures: Extract<LyricResponse, { status: "unavailable" }>[] = [];
  const load = async (url: string) => {
    const response = await transport.read(url);
    if (response.status === "unavailable") failures.push(response);
    return response.status === "ok" ? response.data : undefined;
  };
  const exactUrl = ([title, artist]: [string, string]) => {
    const query = new URLSearchParams({ track_name: title, artist_name: artist });
    if (identity.album) query.set("album_name", identity.album);
    if (identity.durationSeconds !== undefined) query.set("duration", String(identity.durationSeconds));
    return `https://lrclib.net/api/get?${query}`;
  };
  const exact = pairs[0] ? await load(exactUrl(pairs[0])) : undefined;
  if (exact && !Array.isArray(exact)) {
    const match = selectLyricsCandidate(identity, [exact as LrcLibTrack]);
    if (match.status === "matched") {
      if(match.track.instrumental||match.track.syncedLyrics&&parseTimedLyrics(match.track.syncedLyrics).some(line=>line.text.trim()))return match;
      candidates.push(match.track);
    }
  }
  const urls = unique([
    ...pairs.map(([title, artist]) => `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`),
    ...(identity.album ? variants.titles.slice(0, 2).map(title => `https://lrclib.net/api/search?${new URLSearchParams({track_name: title, album_name: identity.album!})}`) : []),
    ...variants.titles.slice(0, 4).map(title => `https://lrclib.net/api/search?${new URLSearchParams({ q: `${title} ${identity.artist}` })}`),
    // Provider artist spelling can differ even when its returned metadata verifies.
    ...variants.titles.slice(0, 4).map(title => `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title })}`),
  ]);
  for (let index = 0; index < urls.length; index++) {
    const responses = [await load(urls[index])];
    for (const data of responses) if (Array.isArray(data)) candidates.push(...data as LrcLibTrack[]); else if (data) candidates.push(data as LrcLibTrack);
    const match = selectLyricsCandidate(identity, candidates);
    if (match.status === "matched" && (match.track.instrumental||match.track.syncedLyrics&&parseTimedLyrics(match.track.syncedLyrics).some(line=>line.text.trim()))) return match;
    if (transport.signal.aborted) break;
  }
  const selected = selectLyricsCandidate(identity, candidates);
  // A completed empty request cannot prove absence while another lookup failed.
  if (selected.status === "missing" && failures.length) return {
    status: "unavailable", reason: failures[0].reason,
    ...(failures.some(value => value.retryAfterMs) ? { retryAfterMs: Math.max(...failures.map(value => value.retryAfterMs || 0)) } : {}),
  };
  return selected;
}
