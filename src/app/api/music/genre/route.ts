import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, softFail } from "@/lib/sql";
import { cachedWithStale, cacheKey, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";
import { getGenreTracks } from "@/lib/catalog";
import { GENRE_BY_ID } from "@/lib/genres";

/**
 * Browse a genre.
 *
 * This replaces the old behaviour, which was not a genre browse at all: the
 * search page sent the genre's *label* to /api/music/explore as a free-text
 * query, so "Jazz" ran a title search for the word "jazz". You got songs
 * called "Jazz (feat. …)" and nothing else — none of the actual jazz in the
 * catalogue, because almost no jazz track has "jazz" in its name.
 *
 * What it does instead, in order of authority:
 *
 *   1. Local catalogue, matched on the genre column and on the artist's genre
 *      array. These are tracks we actually hold, so they play instantly.
 *   2. Deezer's genre-scoped chart, for the genres that have a real id.
 *   3. Curated playlists for that genre, via `getGenreTracks`, which is the
 *      only option for the ~20 genres Deezer's taxonomy doesn't model.
 *
 * Local results lead, because "you already have this" is the most useful
 * answer, and are then topped up to the requested limit from the provider.
 *
 * The genre ids live on `GenreDef.deezerId` in lib/genres.ts rather than in a
 * table here. There used to be one local to this file and another in
 * lib/catalog.ts, and they disagreed with each other and with reality — this
 * one had K-Pop and J-Pop mapped to `2`, which is Deezer's African Music, so
 * browsing K-Pop returned Asake and BNXN.
 */

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium: string; cover_big?: string };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const genreId = (searchParams.get("genre") || "").trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "25")));

  if (!genreId) {
    return NextResponse.json({ error: "genre is required" }, { status: 400 });
  }

  const def = GENRE_BY_ID.get(genreId);
  if (!def) {
    return NextResponse.json({ error: "Unknown genre" }, { status: 404 });
  }

  // Every spelling this genre might be stored under, so the SQL matches data
  // imported before normalisation as well as after it.
  const terms = [genreId, def.label.toLowerCase(), ...(def.aliases ?? [])];

  try {
    const result = await cachedWithStale(
      cacheKey("genre:browse", genreId, limit),
      TTL.search,
      async () => {
        const [local, provider] = await Promise.all([
          localTracks(terms, limit),
          deezerGenre(def.deezerId, genreId, limit),
        ]);

        const seen = new Set<string>();
        const out: any[] = [];

        for (const t of local) {
          const k = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }

        for (const t of provider) {
          if (out.length >= limit) break;
          const k = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }

        return { tracks: out.slice(0, limit), genre: def.label };
      },
      { label: "genre-browse" }
    );

    return NextResponse.json(result ?? { tracks: [], genre: def.label });
  } catch (err) {
    console.error("[GenreBrowse]", err);
    return NextResponse.json({ error: "Failed to browse genre" }, { status: 500 });
  }
}

/**
 * Tracks we hold that belong to this genre.
 *
 * Two sources of truth, because genre lives in two places: `Track.genre` is
 * set by the importer when the source supplied one, and `Artist.genres` is
 * populated from MusicBrainz/Deezer. Neither is complete on its own.
 *
 * Ordering puts the most-played first so a browse opens on something good
 * rather than on whatever happened to be inserted last. Popularity is summed
 * in a correlated subquery, not a join: PlayAggregate is keyed
 * (userId, trackId), so joining it directly would emit one row per listener
 * and silently multiply the result set.
 */
async function localTracks(terms: string[], limit: number) {
  const rows = await query<{
    id: string;
    title: string;
    duration: number;
    audioUrl: string;
    coverUrl: string | null;
    artistName: string;
    albumTitle: string | null;
    albumCover: string | null;
    plays: number;
  }>(
    `SELECT t.id, t.title, t.duration, t."audioUrl",
            COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl",
            COALESCE(a.name, '') AS "artistName",
            al.title AS "albumTitle", al."coverUrl" AS "albumCover",
            COALESCE(
              (SELECT SUM(pa.plays)::int FROM "PlayAggregate" pa WHERE pa."trackId" = t.id),
              0
            ) AS plays
       FROM "Track" t
       LEFT JOIN "Artist" a ON a.id = t."artistId"
       LEFT JOIN "Album" al ON al.id = t."albumId"
      WHERE t."audioUrl" IS NOT NULL
        AND (
          lower(t.genre) = ANY($1::text[])
          OR EXISTS (
            SELECT 1 FROM unnest(COALESCE(a.genres, ARRAY[]::text[])) g
             WHERE lower(g) = ANY($1::text[])
          )
        )
      ORDER BY plays DESC, t."createdAt" DESC
      LIMIT $2`,
    [terms, limit]
  ).catch(softFail<any[]>("genre:local", []));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artistName,
    album: r.albumTitle ?? "",
    coverUrl: r.coverUrl ?? r.albumCover ?? "",
    duration: r.duration,
    preview: "",
    source: "library" as const,
    audioUrl: r.audioUrl,
    isDownloaded: true,
  }));
}

/**
 * Provider tracks for a genre.
 *
 * `/chart/<genreId>/tracks` is the good path where an id exists — unlike the
 * artist endpoints, this one really is genre-scoped (464 returns Ice Nine Kills
 * and Wage War, 84 returns Luke Combs).
 *
 * Where there's no id, or the chart comes back empty, fall through to curated
 * playlists. That replaces a keyword query on `genre:"<label>"`, which matched
 * on *title* and so answered "Metal" with "Happy Birthday All Names" and
 * "Classical" with "Classical Option" — worse than showing nothing.
 */
async function deezerGenre(dzId: number | undefined, genreId: string, limit: number) {
  let data: any = null;

  if (dzId !== undefined && dzId > 0) {
    data = await callProvider<any>(
      async (signal) => {
        const url = `https://api.deezer.com/chart/${dzId}/tracks?limit=${limit}`;
        const res = await fetch(url, { signal });
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
      { provider: "deezer", op: "genre-chart", timeoutMs: 5000, attempts: 2 }
    ).catch(() => null);
  }

  let tracks = (data?.data ?? []) as DeezerTrack[];

  if (!tracks.length) {
    /*
     * `getGenreTracks` returns VirtualTrack, which carries the same fields
     * under different names. Mapped rather than re-fetched so both paths share
     * one cache entry with the onboarding artist picker.
     */
    const viaPlaylists = await getGenreTracks(genreId, limit).catch(() => []);
    tracks = viaPlaylists.map((t) => ({
      id: t.deezerId,
      title: t.title,
      duration: t.duration,
      preview: "",
      artist: { id: t.artistDeezerId ?? 0, name: t.artistName },
      album: {
        id: 0,
        title: t.albumTitle ?? "",
        cover_medium: t.coverUrl ?? "",
        cover_big: t.coverUrl ?? undefined,
      },
    }));
  }

  if (!tracks.length) return [];

  // Resolve which of these we already hold, in one query rather than N.
  const ids = tracks.map((t) => String(t.id));
  const owned = await query<{ id: string; deezerId: string; audioUrl: string }>(
    `SELECT id, "deezerId", "audioUrl" FROM "Track"
      WHERE "deezerId" = ANY($1::text[]) AND "audioUrl" IS NOT NULL`,
    [ids]
  ).catch(softFail<any[]>("genre:owned", []));

  const ownedByDeezerId = new Map(owned.map((o) => [o.deezerId, o]));

  return tracks.map((t) => {
    const local = ownedByDeezerId.get(String(t.id));
    return {
      id: local ? local.id : `deezer-${t.id}`,
      title: t.title,
      artist: t.artist.name,
      album: t.album.title,
      albumId: t.album.id,
      coverUrl: t.album.cover_big || t.album.cover_medium,
      duration: t.duration,
      preview: t.preview,
      source: local ? ("library" as const) : ("deezer" as const),
      audioUrl: local?.audioUrl ?? null,
      isDownloaded: !!local,
      deezerTrackId: t.id,
    };
  });
}
