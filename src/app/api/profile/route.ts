import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheDel, cacheKey, TTL } from "@/lib/cache";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const key = cacheKey("profile", userId);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

  // Run all profile queries in parallel
  const [user, statsRow, topArtists, topTracks] = await Promise.all([
    // 1. Core user info + aggregate counts in one pass
    queryOne(
      `SELECT
         u.id, u.username, u.email, u."avatarUrl", u.bio, u."createdAt",
         COALESCE(pl."playlistCount", 0)::int  AS "playlistCount",
         COALESCE(fv."favoriteCount", 0)::int  AS "favoriteCount",
         COALESCE(lh."historyCount", 0)::int   AS "historyCount"
       FROM "User" u
       LEFT JOIN (
         SELECT "userId", COUNT(*)::int AS "playlistCount"
         FROM "Playlist" GROUP BY "userId"
       ) pl ON pl."userId" = u.id
       LEFT JOIN (
         SELECT "userId", COUNT(*)::int AS "favoriteCount"
         FROM "Favorite" GROUP BY "userId"
       ) fv ON fv."userId" = u.id
       LEFT JOIN (
         SELECT "userId", COUNT(*)::int AS "historyCount"
         FROM "ListeningHistory" GROUP BY "userId"
       ) lh ON lh."userId" = u.id
       WHERE u.id = $1`,
      [userId]
    ),

    // 2. Listening stats: total hours, unique artist count, streak
    queryOne<{
      totalHours: number;
      uniqueArtists: number;
      streakDays: number;
    }>(
      `WITH daily AS (
         SELECT DATE(h."playedAt") AS day
         FROM "ListeningHistory" h
         JOIN "Track" t ON t.id = h."trackId"
         WHERE h."userId" = $1
         GROUP BY DATE(h."playedAt")
       ),
       -- number each day and compute the gap to the previous day
       numbered AS (
         SELECT day,
                day - (ROW_NUMBER() OVER (ORDER BY day))::int * INTERVAL '1 day' AS grp
         FROM daily
       ),
       -- longest run of consecutive days ending today (or yesterday)
       streaks AS (
         SELECT COUNT(*)::int AS len, MAX(day) AS last_day
         FROM numbered
         GROUP BY grp
       ),
       current_streak AS (
         SELECT COALESCE(
           (SELECT len FROM streaks
            WHERE last_day >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY last_day DESC LIMIT 1),
           0
         ) AS "streakDays"
       ),
       hours AS (
         SELECT COALESCE(SUM(t.duration)::float / 3600, 0) AS "totalHours"
         FROM "ListeningHistory" h
         JOIN "Track" t ON t.id = h."trackId"
         WHERE h."userId" = $1
       ),
       artists AS (
         SELECT COUNT(DISTINCT t."artistId")::int AS "uniqueArtists"
         FROM "ListeningHistory" h
         JOIN "Track" t ON t.id = h."trackId"
         WHERE h."userId" = $1
       )
       SELECT h."totalHours", a."uniqueArtists", cs."streakDays"
       FROM hours h, artists a, current_streak cs`,
      [userId]
    ),

    // 3. Top artists this calendar year
    query<{
      id: string;
      name: string;
      trackCount: number;
      avatarUrl: string | null;
    }>(
      `SELECT a.id, a.name, a."imageUrl" AS "avatarUrl",
              COUNT(DISTINCT h."trackId")::int AS "trackCount"
       FROM "ListeningHistory" h
       JOIN  "Track"  t ON t.id = h."trackId"
       JOIN  "Artist" a ON a.id = t."artistId"
       WHERE h."userId" = $1 AND h."playedAt" >= $2
       GROUP BY a.id, a.name, a."imageUrl"
       ORDER BY "trackCount" DESC
       LIMIT 5`,
      [userId, yearStart]
    ),

    // 4. Top tracks this calendar year
    query<{
      id: string;
      title: string;
      artist: string;
      coverUrl: string | null;
    }>(
      `SELECT t.id, t.title, a.name AS artist,
              COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl",
              COUNT(*)::int AS "playCount"
       FROM "ListeningHistory" h
       JOIN  "Track"  t  ON t.id  = h."trackId"
       LEFT JOIN "Artist" a  ON a.id  = t."artistId"
       LEFT JOIN "Album"  al ON al.id = t."albumId"
       WHERE h."userId" = $1 AND h."playedAt" >= $2
       GROUP BY t.id, t.title, a.name, t."coverUrl", al."coverUrl"
       ORDER BY "playCount" DESC
       LIMIT 5`,
      [userId, yearStart]
    ),
  ]);

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";

  const totalHours = Math.round(statsRow?.totalHours ?? 0);
  const tracksPlayed = user?.historyCount ?? 0;
  const uniqueArtists = statsRow?.uniqueArtists ?? 0;
  const playlistCount = user?.playlistCount ?? 0;
  const streakDays = statsRow?.streakDays ?? 0;

  const result = {
    id: user?.id,
    name: user?.username ?? "Listener",
    email: user?.email ?? "",
    avatarUrl: user?.avatarUrl ?? null,
    bio: user?.bio ?? "",
    memberSince,
    plan: "Free",
    stats: [
      { label: "Hours", value: totalHours >= 1000 ? `${(totalHours / 1000).toFixed(1)}k` : String(totalHours) },
      { label: "Tracks", value: tracksPlayed >= 1000 ? `${(tracksPlayed / 1000).toFixed(1)}k` : String(tracksPlayed) },
      { label: "Artists", value: uniqueArtists >= 1000 ? `${(uniqueArtists / 1000).toFixed(1)}k` : String(uniqueArtists) },
      { label: "Playlists", value: String(playlistCount) },
      { label: "Streak", value: streakDays > 0 ? `${streakDays}d` : "—" },
    ],
    topArtists,
    topTracks,
  };

  await cacheSet(key, result, TTL.PROFILE);
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { username, bio, avatarUrl } = await req.json();

  if (username !== undefined) {
    if (typeof username !== "string" || username.length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    }
    const existing = await queryOne(
      `SELECT id FROM "User" WHERE username = $1 AND id != $2`,
      [username, userId]
    );
    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (username !== undefined) { fields.push(`username = $${idx++}`); values.push(username); }
  if (bio !== undefined)      { fields.push(`bio = $${idx++}`);       values.push(bio); }
  if (avatarUrl !== undefined){ fields.push(`"avatarUrl" = $${idx++}`);values.push(avatarUrl); }

  if (fields.length > 0) {
    values.push(userId);
    await execute(`UPDATE "User" SET ${fields.join(", ")} WHERE id = $${idx}`, values);
    await cacheDel(cacheKey("profile", userId));
  }

  return NextResponse.json({ ok: true });
}
