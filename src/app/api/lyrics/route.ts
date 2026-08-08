import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { callProvider, HttpError } from "@/lib/resilience";
import { cachedWithStale, cacheKey } from "@/lib/cache";
// @ts-ignore
import { SyncLyrics } from "@stef-0012/synclyrics";

const UA = "Sakura Music Player (https://github.com/billighost/sakura)";

/**
 * Lyrics providers are consulted in order of how well they answer, and the
 * cascade stops as soon as it has synced lyrics — the thing the UI actually
 * wants. Each provider is wrapped in its own breaker, so a dead one costs a
 * single short-circuit rather than a timeout on every request.
 *
 * The whole result is cached with a stale fallback: lyrics for a given track
 * never change, so the only reason to re-ask is that we never got an answer.
 */
const LYRICS_TTL_SECONDS = 30 * 24 * 60 * 60;

// Shared LyricsManager instance — re-used across requests to allow token caching for Musixmatch
let lyricsManager: any = null;

function getLyricsManager() {
  if (!lyricsManager) {
    lyricsManager = new SyncLyrics({
      logLevel: "none",
      sources: ["musixmatch", "lrclib", "netease"],
    });
  }
  return lyricsManager;
}

interface LyricsResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  timedLyrics: any;
  source: string;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title");
  const artist = searchParams.get("artist");
  const album = searchParams.get("album") || undefined;
  const duration = searchParams.get("duration");

  if (!title || !artist) {
    return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
  }

  const durSec = duration ? Math.round(parseFloat(duration)) : undefined;

  const key = cacheKey(
    "lyrics",
    `${artist}|${title}|${durSec ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim(),
  );

  const result = await cachedWithStale<LyricsResult>(
    key,
    LYRICS_TTL_SECONDS,
    () => resolveLyrics(title, artist, album, durSec),
    { label: "lyrics" },
  );

  if (result && (result.syncedLyrics || result.plainLyrics)) {
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }

  return NextResponse.json({ error: "No lyrics found" }, { status: 404 });
}

async function resolveLyrics(
  title: string,
  artist: string,
  album: string | undefined,
  durSec: number | undefined,
): Promise<LyricsResult | null> {
  const durMs = durSec ? durSec * 1000 : undefined;
  const titleEncoded = encodeURIComponent(title);
  const artistEncoded = encodeURIComponent(artist);

  // Fetch all 4 sources in parallel using Promise.allSettled
  const [lyricaRes, lrcGetRes, lrcSearchRes, synclyricsRes] = await Promise.allSettled([
    callProvider<any>(
      async (signal) => {
        const url =
          `https://wilooper-lyrica.hf.space/lyrics/?artist=${artistEncoded}` +
          `&song=${titleEncoded}&timestamps=true&romanize=true&language=en`;
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
      { provider: "lyrica", op: "get", timeoutMs: 8000, attempts: 2 },
    ),
    callProvider<any>(
      async (signal) => {
        let url = `https://lrclib.net/api/get?artist_name=${artistEncoded}&track_name=${titleEncoded}`;
        if (album) url += `&album_name=${encodeURIComponent(album)}`;
        if (durSec) url += `&duration=${durSec}`;
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
        if (res.status === 404) return null;
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
      { provider: "lrclib", op: "get", timeoutMs: 5000, attempts: 2 },
    ),
    callProvider<any[]>(
      async (signal) => {
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal });
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
      { provider: "lrclib", op: "search", timeoutMs: 5000, attempts: 2 },
    ),
    callProvider<any>(
      async () => getLyricsManager().getLyrics({ track: title, artist, album, length: durMs }),
      { provider: "synclyrics", op: "get", timeoutMs: 8000, attempts: 1 },
    )
  ]);

  let syncedLyrics = "";
  let plainLyrics = "";
  let timedLyrics: any = null;
  let source = "";

  // Process in order of priority

  // 0. Lyrica
  if (lyricaRes.status === "fulfilled" && lyricaRes.value?.status === "success" && lyricaRes.value.data) {
    const data = lyricaRes.value.data;
    syncedLyrics = data.syncedLyrics || "";
    plainLyrics = data.lyrics || "";
    timedLyrics = data.timed_lyrics || null;
    if (syncedLyrics || plainLyrics) source = "lyrica";
  }

  // 1. LRCLib exact get
  if (!syncedLyrics && !plainLyrics && lrcGetRes.status === "fulfilled" && lrcGetRes.value && !lrcGetRes.value.error) {
    const data = lrcGetRes.value;
    syncedLyrics = data.syncedLyrics || "";
    plainLyrics = data.plainLyrics || data.lyrics || "";
    source = "lrclib-direct";
  }

  // 2. LRCLib search
  if (!syncedLyrics && lrcSearchRes.status === "fulfilled" && lrcSearchRes.value?.length) {
    const results = lrcSearchRes.value;
    const scored = results.map((r: any) => {
      let score = 0;
      if (r.trackName?.toLowerCase() === title.toLowerCase()) score += 4;
      else if (r.trackName?.toLowerCase().includes(title.toLowerCase())) score += 2;
      if (r.artistName?.toLowerCase() === artist.toLowerCase()) score += 3;
      else if (r.artistName?.toLowerCase().includes(artist.toLowerCase())) score += 1;
      if (album && r.albumName?.toLowerCase() === album.toLowerCase()) score += 2;
      if (durSec && r.duration && Math.abs(r.duration - durSec) <= 2) score += 3;
      else if (durSec && r.duration && Math.abs(r.duration - durSec) <= 5) score += 1;
      if (r.syncedLyrics) score += 1; // prefer synced
      return { r, score };
    });
    scored.sort((a: any, b: any) => b.score - a.score);
    const match = scored[0].r;
    if (match.syncedLyrics || match.plainLyrics) {
      syncedLyrics = match.syncedLyrics || "";
      plainLyrics = match.plainLyrics || match.lyrics || plainLyrics;
      source = "lrclib-search";
    }
  }

  // 3. Musixmatch / NetEase via synclyrics
  if (!syncedLyrics && synclyricsRes.status === "fulfilled" && synclyricsRes.value?.lyrics) {
    const result = synclyricsRes.value;
    const lineSynced = result.lyrics.lineSynced?.lyrics || "";
    const plain = result.lyrics.plain?.lyrics || "";
    if (lineSynced) {
      syncedLyrics = lineSynced;
      source = result.lyrics.lineSynced?.source || "synclyrics";
    }
    if (plain && !plainLyrics) plainLyrics = plain;
  }

  if (!syncedLyrics && !plainLyrics) return null;

  return {
    syncedLyrics: syncedLyrics || null,
    plainLyrics: plainLyrics || null,
    timedLyrics: timedLyrics || null,
    source: source || "unknown",
  };
}
