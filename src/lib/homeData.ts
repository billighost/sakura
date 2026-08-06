import { query, queryOne } from "@/lib/sql";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";
import { updateSystemPlaylist } from "@/lib/charts";
import { generateUserMixes } from "@/app/api/home/mixes/route";

export type HomeData = {
  user: { name: string; avatarUrl: string | null };
  quickPicks: { id: string; title: string; artist: string; coverUrl: string | null }[];
  recentlyPlayed: { id: string; title: string; artist: string; coverUrl: string | null }[];
  topArtists: { id: string; name: string; trackCount: number; avatarUrl: string | null }[];
  playlists: { id: string; name: string; trackCount: number; coverUrl: string | null }[];
  madeForYou: { id: string; label: string; coverUrl: string | null; tint: string }[];
  systemPlaylists: { id: string; systemId: string; name: string; coverUrl: string | null }[];
};

function triggerDailyUpdate() {
  setTimeout(async () => {
    try {
      await updateSystemPlaylist("top-50-global", "Top 50 Global", "global");
      await updateSystemPlaylist("top-50-country", "Top 50 in your Country", "country");
      await updateSystemPlaylist("top-50-nigeria", "Top 50 Nigeria", "nigeria");
      await updateSystemPlaylist("top-50-africa", "Top 50 Africa", "africa");
      await updateSystemPlaylist("top-50-community", "Sakura Global Top 50", "community");
    } catch (e) {
      console.error("[HomeData] Failed to update system playlists:", e);
    }
  }, 100);
}

export async function getHomeData(userId: string): Promise<HomeData> {
  const key = cacheKey("home", userId);
  const cached = await cacheGet<HomeData>(key);
  if (cached) return cached;

  // Check if system playlists need updating
  queryOne<{ updatedAt: Date }>(`SELECT "updatedAt" FROM "SystemPlaylist" WHERE "systemId" = 'top-50-global'`)
    .then(globalPl => {
      if (!globalPl || Date.now() - new Date(globalPl.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
        triggerDailyUpdate();
      }
    })
    .catch(() => triggerDailyUpdate());

  const [user, quickPicks, recentlyPlayed, topArtists, playlists, mixes, systemPlaylists] =
    await Promise.all([
      // 1. User info
      queryOne<{ name: string; avatarUrl: string | null }>(
        `SELECT username AS name, "avatarUrl" FROM "User" WHERE id = $1`,
        [userId]
      ),

      // 2. Quick Picks
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

      // 3. Recently played
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

      // 4. Top artists
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

      // 5. User playlists
      query<{ id: string; name: string; trackCount: number; coverUrl: string | null }>(
        `SELECT p.id, p.name, p."coverUrl",
                COUNT(pt."trackId")::int AS "trackCount"
         FROM "Playlist" p
         LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
         WHERE p."userId" = $1
         GROUP BY p.id, p.name, p."coverUrl"
         ORDER BY p."createdAt" DESC
         LIMIT 3`,
        [userId]
      ).catch(() => []),

      // 6. Active user mixes
      query<{ id: string; label: string; coverUrl: string | null; tint: string }>(
        `SELECT id, label, "coverUrl", tint
         FROM "UserMix"
         WHERE "userId" = $1 AND "expiresAt" > NOW()
         ORDER BY "generatedAt" DESC
         LIMIT 4`,
        [userId]
      ).catch(() => []),

      // 7. System Playlists (Top 50s)
      query<{ id: string; systemId: string; name: string; coverUrl: string | null }>(
        `SELECT id, "systemId", name, "coverUrl"
         FROM "SystemPlaylist"
         ORDER BY "name" ASC`
      ).catch(() => []),
    ]);

  const result = {
    user: user ?? { name: "Listener", avatarUrl: null },
    quickPicks,
    recentlyPlayed,
    topArtists,
    playlists,
    madeForYou: mixes,
    systemPlaylists,
  };

  // If no mixes exist, it means this user's mixes are expired or haven't been generated
  if (mixes.length === 0) {
    setTimeout(async () => {
      try {
        await generateUserMixes(userId);
      } catch (e) {
        console.error("[HomeData] Failed to generate user mixes:", e);
      }
    }, 100);
  }

  await cacheSet(key, result, TTL.HOME);
  return result;
}
