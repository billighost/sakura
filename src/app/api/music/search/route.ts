import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";

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

  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
      { next: { revalidate: 300 } }
    );
    const data = await res.json();

    const deezerTracks = (data.data || []) as DeezerTrack[];

    const tracks = await Promise.all(
      deezerTracks.map(async (t) => {
        let isDownloaded = false;
        let dbTrackId: string | null = null;
        let audioUrl: string | null = null;

        const existing = await query<{ id: string; audioUrl: string }>(
          `SELECT t.id, t."audioUrl" FROM "Track" t
           WHERE t."deezerId" = $1
           OR (t.title ILIKE $2 AND t."artistId" IN (
             SELECT a.id FROM "Artist" a WHERE a.name ILIKE $3
           ))
           LIMIT 1`,
          [t.id, `%${t.title}%`, `%${t.artist.name}%`]
        );

        if (existing.length > 0) {
          isDownloaded = true;
          dbTrackId = existing[0].id;
          audioUrl = existing[0].audioUrl;
        }

        return {
          id: isDownloaded && dbTrackId ? dbTrackId : `deezer-${t.id}`,
          title: t.title,
          artist: t.artist.name,
          artistImage: t.artist.picture_medium || null,
          album: t.album.title,
          albumId: t.album.id,
          coverUrl: t.album.cover_big || t.album.cover_medium,
          duration: t.duration,
          preview: t.preview,
          source: isDownloaded ? ("library" as const) : ("deezer" as const),
          audioUrl,
          isDownloaded,
          deezerTrackId: t.id,
          contributors: t.contributors?.map((c) => ({
            name: c.name,
            role: c.role,
            imageUrl: c.picture_medium,
          })) || [],
        };
      })
    );

    return NextResponse.json({ tracks, total: data.total || 0 });
  } catch (error) {
    console.error("[Deezer Search]", error);
    return NextResponse.json(
      { error: "Failed to search music" },
      { status: 500 }
    );
  }
}
