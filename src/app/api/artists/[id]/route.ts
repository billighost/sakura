import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = cacheKey("artist", id);

  try {
    const cached = await cacheGet(key);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }

    let deezerId: string | null = null;
    let localArtist = null;
    let isUuid = UUID_REGEX.test(id);

    if (isUuid) {
      localArtist = await queryOne(
        `WITH track_counts AS (
           SELECT 
             (SELECT COUNT(DISTINCT id) FROM "Track" WHERE "artistId" = $1) +
             (SELECT COUNT(DISTINCT "trackId") FROM "TrackArtist" WHERE "artistId" = $1) AS "trackCount"
         )
         SELECT
          a.*,
          tc."trackCount"::int AS "trackCount",
          COUNT(DISTINCT al.id)::int AS "albumCount"
        FROM "Artist" a
        LEFT JOIN "Album" al ON al."artistId" = a.id
        CROSS JOIN track_counts tc
        WHERE a.id = $1
        GROUP BY a.id, tc."trackCount"`,
        [id],
      );
      if (localArtist) deezerId = localArtist.deezerId;
    } else {
      deezerId = id.startsWith("deezer-") ? id.replace("deezer-", "") : id;
    }

    let finalArtist: any = null;
    let finalAlbums: any[] = [];
    let finalTracks: any[] = [];

    if (localArtist) {
      finalArtist = localArtist;
      [finalAlbums, finalTracks] = await Promise.all([
        query(
          `SELECT
            al.*,
            COUNT(t.id)::int AS "trackCount"
          FROM "Album" al
          LEFT JOIN "Track" t ON t."albumId" = al.id
          WHERE al."artistId" = $1
          GROUP BY al.id
          ORDER BY al.title ASC`,
          [id],
        ),
        query(
          `SELECT
            t.id, t.title, t.duration, t."trackNumber", t.genre, t."audioUrl", t."coverUrl", t."deezerId",
            json_build_object('name', a.name, 'id', a.id) AS artist,
            json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id) AS album,
            COALESCE(
              (SELECT json_agg(json_build_object('name', a2.name, 'id', a2.id, 'role', ta.role))
               FROM "TrackArtist" ta
               JOIN "Artist" a2 ON ta."artistId" = a2.id
               WHERE ta."trackId" = t.id),
              '[]'::json
            ) AS "otherArtists"
          FROM "Track" t
          LEFT JOIN "Artist" a ON t."artistId" = a.id
          LEFT JOIN "Album" al ON t."albumId" = al.id
          WHERE t."artistId" = $1
             OR EXISTS (SELECT 1 FROM "TrackArtist" ta WHERE ta."trackId" = t.id AND ta."artistId" = $1)
          ORDER BY t."createdAt" DESC`,
          [id],
        ),
      ]);
      finalTracks = finalTracks.map(t => ({ ...t, isDownloaded: true }));
    }

    if (deezerId) {
      // Artist, albums and top tracks in parallel, each independently
      // resilient. Previously these were three bare fetches inside a
      // Promise.all, so a single network blip rejected the whole thing and the
      // artist page 500'd even when the local DB had everything needed to
      // render it. Now a failed leg is simply absent and the page degrades to
      // whatever is in the library.
      const [dArtist, dTop, dAlbums] = await Promise.all([
        callProvider<any>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist", timeoutMs: 5000, attempts: 2 },
        ),
        callProvider<any>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}/top?limit=50`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist.top", timeoutMs: 5000, attempts: 2 },
        ),
        callProvider<any>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}/albums`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist.albums", timeoutMs: 5000, attempts: 2 },
        ),
      ]);

      if (dArtist) {
        if (!dArtist.error) {
          if (!finalArtist) {
            finalArtist = {
              id: `deezer-${dArtist.id}`,
              name: dArtist.name,
              imageUrl: dArtist.picture_big || dArtist.picture_medium,
              trackCount: dArtist.nb_fan, // rough proxy
              albumCount: dArtist.nb_album,
              deezerId: dArtist.id.toString()
            };
          } else {
            // update missing fields
            finalArtist.imageUrl = finalArtist.imageUrl || dArtist.picture_big || dArtist.picture_medium;
          }
        }
      }

      if (dAlbums) {
        if (dAlbums.data) {
          const mergedAlbums = [...finalAlbums];
          for (const da of dAlbums.data) {
            if (!mergedAlbums.find(a => a.deezerId === da.id.toString() || a.title === da.title)) {
              mergedAlbums.push({
                id: `deezer-${da.id}`,
                deezerId: da.id.toString(),
                title: da.title,
                coverUrl: da.cover_big || da.cover_medium,
                releaseYear: da.release_date ? parseInt(da.release_date.split("-")[0]) : undefined,
                trackCount: da.track_total || 0,
              });
            }
          }
          finalAlbums = mergedAlbums;
        }
      }

      if (dTop) {
        if (dTop.data) {
          const mergedTracks = [...finalTracks];
          for (const dt of dTop.data) {
            // Deduplicate by deezerId OR title (case insensitive)
            if (!mergedTracks.find(t => t.deezerId === dt.id.toString() || t.title.toLowerCase() === dt.title.toLowerCase())) {
              mergedTracks.push({
                id: `deezer-${dt.id}`,
                deezerId: dt.id.toString(),
                title: dt.title,
                duration: dt.duration,
                artist: { name: dt.artist.name, id: `deezer-${dt.artist.id}` },
                album: { title: dt.album.title, coverUrl: dt.album.cover_big || dt.album.cover_medium, id: `deezer-${dt.album.id}` },
                coverUrl: dt.album.cover_big || dt.album.cover_medium,
                audioUrl: null,
                isDownloaded: false,
                preview: dt.preview,
              });
            }
          }
          finalTracks = mergedTracks;
        }
      }
    }

    if (!finalArtist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    const result = { 
      ...finalArtist, 
      albums: finalAlbums, 
      tracks: finalTracks,
      trackCount: finalTracks.length,
      albumCount: finalAlbums.length
    };
    await cacheSet(key, result, TTL.ARTIST);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch artist:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
