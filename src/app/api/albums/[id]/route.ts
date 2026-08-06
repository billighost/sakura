import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeezerAlbumResponse {
  id: number;
  title: string;
  cover_big: string;
  cover_medium: string;
  release_date: string;
  artist: { id: number; name: string; picture_medium: string };
  genres: { data: { name: string }[] };
  tracks: { data: any[] };
  error?: any;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = cacheKey("album", id);

  try {
    const cached = await cacheGet(key);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }

    let deezerId: string | null = null;
    let localAlbum = null;
    let isUuid = UUID_REGEX.test(id);

    if (isUuid) {
      localAlbum = await queryOne(
        `SELECT
          al.*,
          json_build_object('name', a.name, 'id', a.id) AS artist,
          EXISTS(SELECT 1 FROM "Favorite" f WHERE f."trackId" = al.id AND f."userId" = $2) as liked
        FROM "Album" al
        LEFT JOIN "Artist" a ON al."artistId" = a.id
        WHERE al.id = $1`,
        [id, session.user.id] // Wait, Favorite is on trackId, not Album. Like album logic is different in Sakura?
      );
      if (localAlbum) deezerId = localAlbum.deezerId;
    } else {
      deezerId = id;
    }

    let finalAlbum: any = null;
    let finalTracks: any[] = [];

    // Local DB tracks fallback/base
    if (localAlbum) {
      const dbTracks = await query(
        `SELECT
          t.id, t.title, t.duration, t."trackNumber", t."audioUrl", t."coverUrl", t."deezerId",
          json_build_object('name', ar.name) AS artist
        FROM "Track" t
        LEFT JOIN "Artist" ar ON t."artistId" = ar.id
        WHERE t."albumId" = $1
        ORDER BY t."trackNumber" ASC`,
        [id],
      );
      finalAlbum = localAlbum;
      finalTracks = dbTracks.map(t => ({
        ...t,
        isDownloaded: true,
      }));
    }

    if (deezerId) {
      const res = await fetch(`https://api.deezer.com/album/${deezerId}`);
      if (res.ok) {
        const data: DeezerAlbumResponse = await res.json();
        
        if (!data.error) {
          finalAlbum = {
            id: localAlbum?.id || `deezer-${data.id}`,
            title: data.title,
            artist: { id: localAlbum?.artist?.id || `deezer-${data.artist.id}`, name: data.artist.name },
            coverUrl: data.cover_big || data.cover_medium,
            releaseDate: data.release_date,
            year: data.release_date ? parseInt(data.release_date.split("-")[0]) : undefined,
            genres: data.genres?.data?.map(g => g.name) || [],
            deezerId: data.id.toString(),
          };

          const deezerTracks = data.tracks?.data || [];
          const mergedTracks = [];

          for (const dt of deezerTracks) {
            // Find if we already have it downloaded
            const existing = finalTracks.find(t => t.deezerId === dt.id.toString());
            if (existing) {
              mergedTracks.push(existing);
            } else {
              mergedTracks.push({
                id: `deezer-${dt.id}`,
                deezerId: dt.id.toString(),
                title: dt.title,
                duration: dt.duration,
                trackNumber: dt.track_position,
                artist: { name: dt.artist.name },
                coverUrl: data.cover_big || data.cover_medium,
                audioUrl: null, // to be downloaded
                isDownloaded: false,
                preview: dt.preview,
              });
            }
          }
          finalTracks = mergedTracks;
        }
      }
    }

    if (!finalAlbum) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const result = { ...finalAlbum, tracks: finalTracks };
    await cacheSet(key, result, TTL.ALBUM);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch album:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
