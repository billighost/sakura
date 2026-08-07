import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

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

    // Run local catalogue lookup and Deezer search in parallel.
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

    // Search the music catalogue in parallel.
    const deezerPromise = fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`,
      { signal: AbortSignal.timeout(5000) }
    )
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    const [localTracks, data] = await Promise.all([localPromise, deezerPromise]);

    const localByDeezerId = new Map(localTracks.map((t) => [t.deezerId, t]));
    const deezerTracks = (data?.data || []) as DeezerTrack[];

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

    return NextResponse.json({ tracks, total: data?.total || 0 });
  } catch (error) {
    console.error("[Deezer Search]", error);
    return NextResponse.json(
      { error: "Failed to search music" },
      { status: 500 }
    );
  }
}
