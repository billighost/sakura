import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = (page - 1) * limit;
  const downloadedOnly = searchParams.get("downloaded") === "true";

  const cacheKey = `artists:list:${userId}:${page}:${limit}:${downloadedOnly}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }
  } catch {
    // cache failure — continue to DB
  }

  try {
    let whereClause = "";
    if (downloadedOnly) {
      whereClause = `AND EXISTS (
        SELECT 1 FROM "Track" t WHERE t."artistId" = a.id
        UNION
        SELECT 1 FROM "TrackArtist" ta WHERE ta."artistId" = a.id
      )`;
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Artist" a
       WHERE EXISTS (
         SELECT 1 FROM "Favorite" f
         LEFT JOIN "Track" t ON f."trackId" = t.id
         LEFT JOIN "TrackArtist" ta ON f."trackId" = ta."trackId"
         WHERE (t."artistId" = a.id OR ta."artistId" = a.id) AND f."userId" = $1
       ) OR EXISTS (
         SELECT 1 FROM "PlaylistTrack" pt
         JOIN "Playlist" p ON pt."playlistId" = p.id
         LEFT JOIN "Track" t ON pt."trackId" = t.id
         LEFT JOIN "TrackArtist" ta ON pt."trackId" = ta."trackId"
         WHERE (t."artistId" = a.id OR ta."artistId" = a.id) AND p."userId" = $1
       ) ${whereClause}`,
      [userId]
    );
    const total = parseInt(countResult?.count || "0", 10);

    const artists = await query(
      `SELECT
        a.*,
        COUNT(DISTINCT t.id)::int + COUNT(DISTINCT ta."trackId")::int AS "trackCount",
        COUNT(DISTINCT al.id)::int AS "albumCount"
      FROM "Artist" a
      LEFT JOIN "Track" t ON t."artistId" = a.id
      LEFT JOIN "TrackArtist" ta ON ta."artistId" = a.id
      LEFT JOIN "Album" al ON al."artistId" = a.id
      WHERE (
        EXISTS (
          SELECT 1 FROM "Favorite" f WHERE (f."trackId" = t.id OR f."trackId" = ta."trackId") AND f."userId" = $3
        ) OR EXISTS (
          SELECT 1 FROM "PlaylistTrack" pt
          JOIN "Playlist" p ON pt."playlistId" = p.id
          WHERE (pt."trackId" = t.id OR pt."trackId" = ta."trackId") AND p."userId" = $3
        )
      ) ${whereClause}
      GROUP BY a.id
      ORDER BY a.name ASC
      LIMIT $1 OFFSET $2`,
      [limit, offset, userId],
    );

    const result = { artists, total, page, limit, pages: Math.ceil(total / limit) };

    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: 60 });
    } catch {
      // cache write failure — non-critical
    }

    return NextResponse.json(result, { headers: { "X-Cache": "MISS" } });
  } catch (err) {
    console.error("Failed to fetch artists:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
