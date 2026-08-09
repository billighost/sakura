import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/sql";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { normaliseGenre } from "@/lib/taste";

/**
 * Choices for the onboarding picker.
 *
 * Genres come from a curated list rather than straight from the catalogue:
 * raw genre tags are messy, long-tailed and full of near-duplicates, which
 * makes for a terrible picker even when the underlying data is fine. The
 * curated list is intersected with what actually exists so we never offer a
 * genre with nothing behind it — except when the catalogue is too small to
 * fill a screen, where showing the full list is better than showing three.
 *
 * Artists come from the catalogue, ranked by real popularity, with a Deezer
 * top-up so a fresh install still presents recognisable names.
 *
 * Each genre carries an `icon` key, not an emoji. Emoji render differently on
 * every platform, can't be themed, can't be animated, and are the single
 * clearest sign an interface was assembled rather than designed. The key maps
 * to a drawn scene in `GENRE_ICONS` on the client.
 */

const CURATED_GENRES = [
  { id: "afrobeats", label: "Afrobeats", icon: "afro" },
  { id: "hip-hop", label: "Hip-Hop", icon: "hiphop" },
  { id: "rnb", label: "R&B", icon: "rnb" },
  { id: "pop", label: "Pop", icon: "pop" },
  { id: "amapiano", label: "Amapiano", icon: "afro" },
  { id: "rock", label: "Rock", icon: "rock" },
  { id: "alternative", label: "Alternative", icon: "rock" },
  { id: "indie", label: "Indie", icon: "folk" },
  { id: "electronic", label: "Electronic", icon: "electronic" },
  { id: "edm", label: "Dance / EDM", icon: "house" },
  { id: "house", label: "House", icon: "house" },
  { id: "drum & bass", label: "Drum & Bass", icon: "electronic" },
  { id: "jazz", label: "Jazz", icon: "jazz" },
  { id: "soul", label: "Soul", icon: "gospel" },
  { id: "funk", label: "Funk", icon: "reggae" },
  { id: "reggae", label: "Reggae", icon: "reggae" },
  { id: "dancehall", label: "Dancehall", icon: "reggae" },
  { id: "country", label: "Country", icon: "folk" },
  { id: "classical", label: "Classical", icon: "classical" },
  { id: "metal", label: "Metal", icon: "metal" },
  { id: "punk", label: "Punk", icon: "metal" },
  { id: "k-pop", label: "K-Pop", icon: "kpop" },
  { id: "latin", label: "Latin", icon: "latin" },
  { id: "gospel", label: "Gospel", icon: "gospel" },
  { id: "lo-fi", label: "Lo-Fi", icon: "lofi" },
  { id: "ambient", label: "Ambient", icon: "lofi" },
  { id: "blues", label: "Blues", icon: "jazz" },
  { id: "folk", label: "Folk", icon: "folk" },
  { id: "highlife", label: "Highlife", icon: "afro" },
  { id: "drill", label: "Drill", icon: "hiphop" },
];

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = cacheKey("onboarding-seeds", "v1");
  const cached = await cacheGet(key);
  if (cached) return NextResponse.json(cached);

  const [catalogueGenres, artists] = await Promise.all([
    query<{ genre: string }>(
      `SELECT DISTINCT unnest(genres) AS genre FROM "Artist"
       WHERE genres IS NOT NULL AND array_length(genres, 1) > 0
       UNION
       SELECT DISTINCT genre FROM "Track" WHERE genre IS NOT NULL AND genre <> ''`
    ).catch(() => []),
    query<{ id: string; name: string; imageUrl: string | null; trackCount: number; plays: number; genres: string[] | null }>(
      `SELECT a.id, a.name, a."imageUrl", a.genres,
              COUNT(DISTINCT t.id)::int AS "trackCount",
              COALESCE(COUNT(h.id), 0)::int AS plays
       FROM "Artist" a
       JOIN "Track" t ON t."artistId" = a.id
       LEFT JOIN "ListeningHistory" h ON h."trackId" = t.id
       GROUP BY a.id, a.name, a."imageUrl", a.genres
       HAVING COUNT(DISTINCT t.id) > 0
       ORDER BY plays DESC, "trackCount" DESC
       LIMIT 60`
    ).catch(() => []),
  ]);

  const available = new Set(
    catalogueGenres.map((g) => normaliseGenre(g.genre)).filter(Boolean) as string[]
  );

  // Only filter down to what exists once there's enough there to make a real
  // picker. On a sparse catalogue an unfiltered list is far more useful — the
  // answers still seed the profile and drive Deezer-backed discovery.
  const genres =
    available.size >= 8
      ? CURATED_GENRES.filter((g) => available.has(g.id))
      : CURATED_GENRES;

  const result = {
    genres: genres.length >= 6 ? genres : CURATED_GENRES,
    artists: artists.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
      trackCount: a.trackCount,
      // Normalised so the client can match them against picked genre ids
      // without duplicating the alias table.
      genres: (a.genres ?? []).map(normaliseGenre).filter(Boolean) as string[],
    })),
  };

  await cacheSet(key, result, 600);
  return NextResponse.json(result);
}
