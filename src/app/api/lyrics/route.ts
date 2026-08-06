import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
// @ts-ignore
import { SyncLyrics } from "@stef-0012/synclyrics";

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

  try {
    const durSec = duration ? Math.round(parseFloat(duration)) : undefined;
    const durMs = durSec ? durSec * 1000 : undefined;
    let syncedLyrics = "";
    let plainLyrics = "";
    let source = "";

    const titleEncoded = encodeURIComponent(title);
    const artistEncoded = encodeURIComponent(artist);

    // 1. Try LRCLib direct get — most reliable for exact matches with duration
    try {
      let lrcUrl = `https://lrclib.net/api/get?artist_name=${artistEncoded}&track_name=${titleEncoded}`;
      if (album) lrcUrl += `&album_name=${encodeURIComponent(album)}`;
      if (durSec) lrcUrl += `&duration=${durSec}`;
      const response = await fetch(lrcUrl, {
        headers: { "User-Agent": "Sakura Music Player (https://github.com/billighost/sakura)" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data && !data.error) {
          syncedLyrics = data.syncedLyrics || "";
          plainLyrics = data.plainLyrics || data.lyrics || "";
          source = "lrclib-direct";
        }
      }
    } catch (e) {
      console.warn("[Lyrics API Server] LRCLib specific get failed:", e);
    }

    // 2. Try LRCLib search if no synced lyrics — search is fuzzier and finds more results
    if (!syncedLyrics) {
      try {
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
        const searchRes = await fetch(searchUrl, {
          headers: { "User-Agent": "Sakura Music Player (https://github.com/billighost/sakura)" },
          signal: AbortSignal.timeout(5000),
        });
        if (searchRes.ok) {
          const results = await searchRes.json();
          if (results && results.length > 0) {
            // Score results by title, artist, album, duration accuracy
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
        }
      } catch (e) {
        console.warn("[Lyrics API Server] LRCLib search failed:", e);
      }
    }

    // 3. Try @stef-0012/synclyrics (Musixmatch / NetEase) if still missing synced lyrics
    if (!syncedLyrics) {
      try {
        const manager = getLyricsManager();
        const result = await manager.getLyrics({
          track: title,
          artist,
          album,
          length: durMs,
        });
        if (result?.lyrics) {
          const lineSynced = result.lyrics.lineSynced?.lyrics || "";
          const plain = result.lyrics.plain?.lyrics || "";
          if (lineSynced) {
            syncedLyrics = lineSynced;
            source = result.lyrics.lineSynced?.source || "synclyrics";
          }
          if (plain && !plainLyrics) {
            plainLyrics = plain;
          }
        }
      } catch (e) {
        console.warn("[Lyrics API Server] @stef-0012/synclyrics lookup failed:", e);
      }
    }

    if (syncedLyrics || plainLyrics) {
      return NextResponse.json({
        syncedLyrics: syncedLyrics || null,
        plainLyrics: plainLyrics || null,
        source: source || "unknown",
      });
    }

    return NextResponse.json({ error: "No lyrics found" }, { status: 404 });
  } catch (err) {
    console.error("[Lyrics API Server] Failed to fetch lyrics:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
