import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const key = cacheKey("home", userId);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  // Run all queries in parallel — one DB round-trip per logical block.
  const [user, quickPicks, recentlyPlayed, topArtists, playlists, mixes] =
    await Promise.all([
      // 1. User info
      queryOne<{ name: string; avatarUrl: string | null }>(
        `SELECT username AS name, "avatarUrl" FROM "User" WHERE id = $1`,
        [userId]
      ),

      // 2. Quick Picks — random sample of tracks the user has in their library
      //    (played at least once). Falls back to newest tracks if no history.
      query<{ id: string; title: string; artist: string; coverUrl: string | null }>(
        `SELECT t.id, t.title, a.name AS artist, COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl"
         FROM "Track" t
         LEFT JOIN "Artist" a ON a.id = t."artistId"
         LEFT JOIN "Album"  al ON al.id = t."albumId"
         WHERE t.id IN (
           SELECT DISTINCT "trackId" FROM "ListeningHistory" WHERE "userId" = $1
           UNION
           SELECT "trackId" FROM "Favorite" WHERE "userId" = $1
         )
         ORDER BY RANDOM()
         LIMIT 6`,
        [userId]
      ).catch(() => []),

      // 3. Recently played — distinct tracks, most recent first
      query<{ id: string; title: string; artist: string; coverUrl: string | null }>(
        `SELECT DISTINCT ON (h."trackId")
           t.id, t.title, a.name AS artist,
           COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl"
         FROM "ListeningHistory" h
         JOIN  "Track"  t  ON t.id  = h."trackId"
         LEFT JOIN "Artist" a  ON a.id  = t."artistId"
         LEFT JOIN "Album"  al ON al.id = t."albumId"
         WHERE h."userId" = $1
         ORDER BY h."trackId", h."playedAt" DESC
         LIMIT 12`,
        [userId]
      ).catch(() => []),

      // 4. Top artists — by number of distinct tracks played this user
      query<{ id: string; name: string; trackCount: number; avatarUrl: string | null }>(
        `SELECT a.id, a.name, a."imageUrl" AS "avatarUrl",
                COUNT(DISTINCT h."trackId")::int AS "trackCount"
         FROM "ListeningHistory" h
         JOIN  "Track"  t ON t.id = h."trackId"
         JOIN  "Artist" a ON a.id = t."artistId"
         WHERE h."userId" = $1
         GROUP BY a.id, a.name, a."imageUrl"
         ORDER BY "trackCount" DESC
         LIMIT 8`,
        [userId]
      ).catch(() => []),

      // 5. User playlists with track count
      query<{ id: string; name: string; trackCount: number; coverUrl: string | null }>(
        `SELECT p.id, p.name, p."coverUrl",
                COUNT(pt."trackId")::int AS "trackCount"
         FROM "Playlist" p
         LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
         WHERE p."userId" = $1
         GROUP BY p.id, p.name, p."coverUrl"
         ORDER BY p."createdAt" DESC
         LIMIT 8`,
        [userId]
      ).catch(() => []),

      // 6. Active user mixes (not expired)
      query<{ id: string; label: string; coverUrl: string | null; tint: string }>(
        `SELECT id, label, "coverUrl", tint
         FROM "UserMix"
         WHERE "userId" = $1 AND "expiresAt" > NOW()
         ORDER BY "generatedAt" DESC
         LIMIT 4`,
        [userId]
      ).catch(() => []),
    ]);

  const result = {
    user: user ?? { name: "Listener", avatarUrl: null },
    quickPicks,
    recentlyPlayed,
    topArtists,
    playlists,
    madeForYou: mixes,
  };

  await cacheSet(key, result, TTL.HOME);
  return NextResponse.json(result);
}
