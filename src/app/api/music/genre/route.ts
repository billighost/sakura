import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, softFail } from "@/lib/sql";
import { cachedWithStale, cacheKey, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";
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
 *   2. Deezer's own genre-scoped charts, which return tracks *classified* as
 *      the genre rather than named after it.
 *   3. A last-resort keyword query, only if both above come back empty, so a
 *      thin catalogue still shows something.
 *
 * Local results lead, because "you already have this" is the most useful
 * answer, and are then topped up to the requested limit from the provider.
 */

/** Deezer's genre ids. Their chart endpoint is keyed on these, not on names. */
const DEEZER_GENRE_ID: Record<string, number> = {
  pop: 132,
  "hip-hop": 116,
  rnb: 165,
  rock: 152,
  alternative: 85,
  indie: 85,
  electronic: 106,
  edm: 106,
  house: 106,
  "drum & bass": 106,
  jazz: 129,
  blues: 153,
  soul: 165,
  funk: 165,
  reggae: 144,
  dancehall: 144,
  afrobeats: 2228,
  amapiano: 2228,
  highlife: 2228,
  gospel: 187,
  country: 84,
  folk: 466,
  classical: 98,
  metal: 464,
  punk: 464,
  "k-pop": 2, // Deezer files K-pop under Asian music
  "j-pop": 2,
  latin: 197,
  "lo-fi": 116,
  ambient: 106,
  drill: 116,
  podcast: 0,
};

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
          deezerGenre(genreId, def.label, limit),
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
 * Deezer's genre-scoped chart. This is the part that makes the feature
 * actually work: `/chart/{genreId}/tracks` returns tracks *classified* as the
 * genre. The old code's `/search?q=jazz` returned tracks *named* jazz.
 */
async function deezerGenre(genreId: string, label: string, limit: number) {
  const dzId = DEEZER_GENRE_ID[genreId];

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
    );
  }

  // Nothing classified under that id (or no mapping) — fall back to a keyword
  // query. Still imperfect, but it only runs when the good path found nothing.
  if (!data?.data?.length) {
    data = await callProvider<any>(
      async (signal) => {
        const url = `https://api.deezer.com/search?q=${encodeURIComponent(
          `genre:"${label}"`
        )}&limit=${limit}`;
        const res = await fetch(url, { signal });
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
      { provider: "deezer", op: "genre-search", timeoutMs: 5000, attempts: 2 }
    );
  }

  const tracks = (data?.data ?? []) as DeezerTrack[];
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
