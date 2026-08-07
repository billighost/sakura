import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import { callProvider, HttpError } from "@/lib/resilience";
import { cachedWithStale, cacheKey, TTL } from "@/lib/cache";
import { searchTracksITunes } from "@/lib/metadata";

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: {
    id: number;
    title: string;
    cover_medium: string;
    cover_big?: string;
    release_date?: string;
  };
  contributors?: { id: number; name: string; role: string; picture_medium?: string }[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get("limit") || "10")));

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const rl = await rateLimit(`search:${req.headers.get("x-forwarded-for") ?? "unknown"}`, LIMITS.search.limit, LIMITS.search.window);
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const term = q.trim();

    // Run local catalogue lookup and provider search in parallel. The local
    // half is authoritative for "do we already have this?", the provider half
    // supplies the result set.
    const localPromise = query<{ id: string; deezerId: number; title: string; audioUrl: string }>(
      `SELECT t.id, t."deezerId", t.title, t."audioUrl"
         FROM "Track" t
         JOIN "Artist" a ON a.id = t."artistId"
        WHERE t.title % $1
        UNION
       SELECT t.id, t."deezerId", t.title, t."audioUrl"
         FROM "Track" t
         JOIN "Artist" a ON a.id = t."artistId"
        WHERE a.name % $1
        LIMIT $2`,
      [term, limit]
    ).catch(() => [] as { id: string; deezerId: number; title: string; audioUrl: string }[]);

    // Search results are cached with a stale fallback. A repeated query costs
    // one Redis read instead of a round-trip to Deezer, and if Deezer is down
    // or rate-limiting, a previously-seen query still returns results.
    const searchPromise = cachedWithStale<{ tracks: DeezerTrack[]; total: number }>(
      cacheKey("search", term.toLowerCase(), limit),
      TTL.search,
      () => searchProviders(term, limit),
      { label: "search" },
    );

    const [localTracks, searchResult] = await Promise.all([localPromise, searchPromise]);

    const localByDeezerId = new Map(localTracks.map((t) => [t.deezerId, t]));
    const deezerTracks = searchResult?.tracks ?? [];

    const tracks = deezerTracks.map((t) => {
      const local = localByDeezerId.get(t.id);
      const isDownloaded = !!local;
      return {
        id: isDownloaded ? local!.id : `deezer-${t.id}`,
        title: t.title,
        artist: t.artist.name,
        artistImage: t.artist.picture_medium || null,
        album: t.album.title,
        albumId: t.album.id,
        coverUrl: t.album.cover_big || t.album.cover_medium,
        duration: t.duration,
        preview: t.preview,
        source: isDownloaded ? ("library" as const) : ("deezer" as const),
        audioUrl: local?.audioUrl ?? null,
        isDownloaded,
        deezerTrackId: t.id,
        contributors:
          t.contributors?.map((c) => ({
            name: c.name,
            role: c.role,
            imageUrl: c.picture_medium,
          })) || [],
      };
    });

    return NextResponse.json(
      { tracks, total: searchResult?.total || 0 },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    console.error("[Search]", error);
    return NextResponse.json(
      { error: "Failed to search music" },
      { status: 500 }
    );
  }
}

/**
 * Deezer first, iTunes Search as the fallback.
 *
 * Both are free and keyless. Deezer is preferred because it carries the album
 * id, contributor credits and preview url the UI already renders; iTunes has
 * none of those, so a fallback result is deliberately thinner — but a thin
 * result set beats an empty one when Deezer is unavailable.
 */
async function searchProviders(
  term: string,
  limit: number,
): Promise<{ tracks: DeezerTrack[]; total: number } | null> {
  const deezer = await callProvider<any>(
    async (signal) => {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return res.json();
    },
    { provider: "deezer", op: "search", timeoutMs: 5000, attempts: 3 },
  );

  if (deezer?.data?.length) {
    return { tracks: deezer.data as DeezerTrack[], total: deezer.total ?? deezer.data.length };
  }

  const itunes = await searchTracksITunes(term, limit);
  if (itunes.length) {
    return { tracks: itunes, total: itunes.length };
  }

  return null;
}
