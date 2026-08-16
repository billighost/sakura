import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheKey, cached, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deezer's shapes, narrowed to the fields this route reads.
 *
 * Deliberately loose — every field is optional and the provider is free to add
 * or drop others. The point isn't to model their API, it's to stop a typo in a
 * field name compiling silently, which is what the `any`s here allowed.
 */
interface DeezerArtist {
  id: number;
  name: string;
  picture_big?: string;
  picture_medium?: string;
  nb_fan?: number;
  error?: unknown;
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_big?: string;
  cover_medium?: string;
  release_date?: string;
  track_total?: number;
}

interface DeezerTopTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_big?: string; cover_medium?: string };
}

interface DeezerList<T> {
  data?: T[];
  error?: unknown;
}

/**
 * The merged artist record. Rows come out of `query()` untyped and the Deezer
 * legs contribute a different subset of fields each, so this is the union of
 * both rather than a mirror of either.
 */
interface ArtistRecord {
  id: string;
  name: string;
  imageUrl?: string | null;
  bio?: string | null;
  genres?: string[];
  deezerId?: string | null;
  fans?: number;
  trackCount?: number;
  albumCount?: number;
  [key: string]: unknown;
}

type AlbumRecord = Record<string, unknown> & { id: string; title: string; deezerId?: string };
type TrackRecord = Record<string, unknown> & {
  id: string;
  title: string;
  duration: number;
  deezerId?: string;
  artist?: { name?: string; id?: string };
};

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
    const hit = await cacheGet(key);
    if (hit) {
      return NextResponse.json(hit, { headers: { "X-Cache": "HIT" } });
    }

    /**
     * Single-flighted: a miss here costs two local queries plus three Deezer
     * calls, and artist pages are exactly the kind of link several people open
     * at once. Without coalescing, ten simultaneous views of the same artist
     * meant thirty provider calls — enough to trip the breaker on a resource
     * that was working perfectly well.
     */
    const result = await cached(key, TTL.ARTIST, () => buildArtist(id));
    if (!result) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch artist:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function buildArtist(id: string) {
  {
    let deezerId: string | null = null;
    let localArtist = null;
    const isUuid = UUID_REGEX.test(id);

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

    let finalArtist: ArtistRecord | null = null;
    let finalAlbums: AlbumRecord[] = [];
    let finalTracks: TrackRecord[] = [];
    let finalRelated: { id: string; name: string; imageUrl: string | null }[] = [];

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
      // Artist, albums, top tracks and related artists in parallel, each
      // independently resilient. Previously these were bare fetches inside a
      // Promise.all, so a single network blip rejected the whole thing and the
      // artist page 500'd even when the local DB had everything needed to
      // render it. Now a failed leg is simply absent and the page degrades to
      // whatever is in the library.
      const [dArtist, dTop, dAlbums, dRelated] = await Promise.all([
        callProvider<DeezerArtist>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist", timeoutMs: 5000, attempts: 2 },
        ),
        callProvider<DeezerList<DeezerTopTrack>>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}/top?limit=50`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist.top", timeoutMs: 5000, attempts: 2 },
        ),
        callProvider<DeezerList<DeezerAlbum>>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}/albums`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist.albums", timeoutMs: 5000, attempts: 2 },
        ),
        /*
         * Related artists. One attempt rather than two, and it's the only leg
         * that's purely additive — the page renders a rail if this lands and
         * omits the section if it doesn't, so retrying a flaky call to fill an
         * optional shelf isn't worth the latency it adds to every cold artist
         * view.
         */
        callProvider<DeezerList<DeezerArtist>>(
          async (signal) => {
            const url = `https://api.deezer.com/artist/${deezerId}/related?limit=12`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new HttpError(res.status, url);
            return res.json();
          },
          { provider: "deezer", op: "artist.related", timeoutMs: 4000, attempts: 1 },
        ),
      ]);

      if (dArtist) {
        if (!dArtist.error) {
          if (!finalArtist) {
            finalArtist = {
              id: `deezer-${dArtist.id}`,
              name: dArtist.name,
              imageUrl: dArtist.picture_big || dArtist.picture_medium,
              deezerId: dArtist.id.toString()
            };
          } else {
            // update missing fields
            finalArtist.imageUrl = finalArtist.imageUrl || dArtist.picture_big || dArtist.picture_medium;
          }
          // Deezer's follower count, reported as what it is. It used to be
          // assigned to `trackCount` as a "rough proxy", which the final
          // return then overwrote — so the artist page had no follower figure
          // and the field it was stored in meant something else entirely.
          if (typeof dArtist.nb_fan === "number") finalArtist.fans = dArtist.nb_fan;
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
            // Deduplicate by deezerId OR (title + artist name + duration)
            if (!mergedTracks.find(t => 
              (t.deezerId && t.deezerId === dt.id.toString()) ||
              (t.title.toLowerCase() === dt.title.toLowerCase() && 
               (t.artist?.name || "").toLowerCase() === (dt.artist?.name || "").toLowerCase() &&
               t.duration === dt.duration)
            )) {
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

      if (dRelated?.data) {
        finalRelated = dRelated.data
          // Deezer occasionally lists the artist among their own related
          // artists, which renders as a card that navigates to the page you're
          // already on.
          .filter((da) => da?.id && da.id.toString() !== deezerId)
          .map((da) => ({
            id: `deezer-${da.id}`,
            name: da.name,
            imageUrl: da.picture_big || da.picture_medium || null,
          }));
      }
    }

    if (!finalArtist) return null;

    return {
      ...finalArtist,
      albums: finalAlbums,
      tracks: finalTracks,
      related: finalRelated,
      trackCount: finalTracks.length,
      albumCount: finalAlbums.length
    };
  }
}
