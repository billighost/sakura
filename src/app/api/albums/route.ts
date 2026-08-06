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
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const downloadedOnly = searchParams.get("downloaded") === "true";
  const offset = (page - 1) * limit;

  const cacheKey = `albums:list:${userId}:${page}:${limit}:${downloadedOnly}`;
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
        SELECT 1 FROM "Track" t WHERE t."albumId" = al.id
      )`;
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Album" al
       WHERE EXISTS (
         SELECT 1 FROM "Favorite" f WHERE f."trackId" IN (SELECT id FROM "Track" WHERE "albumId" = al.id) AND f."userId" = $1
       ) OR EXISTS (
         SELECT 1 FROM "PlaylistTrack" pt
         JOIN "Playlist" p ON pt."playlistId" = p.id
         WHERE pt."trackId" IN (SELECT id FROM "Track" WHERE "albumId" = al.id) AND p."userId" = $1
       ) ${whereClause}`,
      [userId]
    );
    const total = parseInt(countResult?.count || "0", 10);

    const albums = await query(
      `SELECT
        al.*,
        json_build_object('name', a.name, 'id', a.id) AS artist,
        COUNT(t.id)::int AS "trackCount"
      FROM "Album" al
      LEFT JOIN "Artist" a ON al."artistId" = a.id
      LEFT JOIN "Track" t ON t."albumId" = al.id
      WHERE (
        EXISTS (
          SELECT 1 FROM "Favorite" f WHERE f."trackId" = t.id AND f."userId" = $3
        ) OR EXISTS (
          SELECT 1 FROM "PlaylistTrack" pt
          JOIN "Playlist" p ON pt."playlistId" = p.id
          WHERE pt."trackId" = t.id AND p."userId" = $3
        )
      ) ${whereClause}
      GROUP BY al.id, a.name, a.id
      ORDER BY al.title ASC
      LIMIT $1 OFFSET $2`,
      [limit, offset, userId],
    );

    const result = { albums, total, page, limit, pages: Math.ceil(total / limit) };

    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: 60 });
    } catch {
      // cache write failure — non-critical
    }

    return NextResponse.json(result, { headers: { "X-Cache": "MISS" } });
  } catch (err) {
    console.error("Failed to fetch albums:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
