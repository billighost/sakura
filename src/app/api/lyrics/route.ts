import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
// @ts-ignore
import { findLyrics } from "@stef-0012/synclyrics";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title");
  const artist = searchParams.get("artist");
  const duration = searchParams.get("duration");

  if (!title || !artist) {
    return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
  }

  try {
    const durSec = duration ? Math.round(parseFloat(duration)) : undefined;
    let syncedLyrics = "";
    let plainLyrics = "";
    let source = "";

    const titleEncoded = encodeURIComponent(title);
    const artistEncoded = encodeURIComponent(artist);

    // 1. Try LRCLib specific get on server
    try {
      let lrcUrl = `https://lrclib.net/api/get?artist_name=${artistEncoded}&track_name=${titleEncoded}`;
      if (durSec) {
        lrcUrl += `&duration=${durSec}`;
      }
      const response = await fetch(lrcUrl, { headers: { "User-Agent": "Sakura Music Player (https://github.com/billighost/sakura)" } });
      if (response.ok) {
        const data = await response.json();
        syncedLyrics = data.syncedLyrics || "";
        plainLyrics = data.plainLyrics || data.lyrics || "";
        source = "lrclib-direct";
      }
    } catch (e) {
      console.warn("[Lyrics API Server] LRCLib specific get failed:", e);
    }

    // 2. Try LRCLib search on server if no synced lyrics found
    if (!syncedLyrics) {
      try {
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
        const searchRes = await fetch(searchUrl, { headers: { "User-Agent": "Sakura Music Player (https://github.com/billighost/sakura)" } });
        if (searchRes.ok) {
          const results = await searchRes.json();
          if (results && results.length > 0) {
            // Find a match with closest duration first if duration is provided
            let match = results[0];
            if (durSec) {
              const exactOrClose = results.find((r: any) => Math.abs(r.duration - durSec) <= 4);
              if (exactOrClose) match = exactOrClose;
            }
            syncedLyrics = match.syncedLyrics || "";
            plainLyrics = match.plainLyrics || match.lyrics || plainLyrics;
            source = "lrclib-search";
          }
        }
      } catch (e) {
        console.warn("[Lyrics API Server] LRCLib search failed:", e);
      }
    }

    // 3. Try `@stef-0012/synclyrics` aggregation (Musixmatch / NetEase) if still no synced lyrics
    if (!syncedLyrics) {
      try {
        const options: any = {};
        if (durSec) options.duration = durSec;
        const result = await findLyrics(artist, title, options);
        if (result) {
          syncedLyrics = result.synced || "";
          plainLyrics = result.plain || plainLyrics;
          source = result.source || "synclyrics-package";
        }
      } catch (e) {
        console.warn("[Lyrics API Server] @stef-0012/synclyrics package lookup failed:", e);
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
