import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cached, cacheKey as buildKey, TTL } from "@/lib/cache";

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

  // Read-through the shared cache: L1 first, single-flight on miss. See the
  // note in the tracks route.
  const key = buildKey("albums:list", userId, page, limit, String(downloadedOnly));

  try {
    let whereClause = "";
    if (downloadedOnly) {
      whereClause = `AND EXISTS (
        SELECT 1 FROM "Track" t WHERE t."albumId" = al.id
      )`;
    }

    const result = await cached(key, TTL.ALBUMS, async () => {
      // Independent queries — issued together rather than back to back.
      const [countResult, albums] = await Promise.all([
        queryOne<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "Album" al
           WHERE EXISTS (
             SELECT 1 FROM "Favorite" f WHERE f."trackId" IN (SELECT id FROM "Track" WHERE "albumId" = al.id) AND f."userId" = $1
           ) OR EXISTS (
             SELECT 1 FROM "PlaylistTrack" pt
             JOIN "Playlist" p ON pt."playlistId" = p.id
             WHERE pt."trackId" IN (SELECT id FROM "Track" WHERE "albumId" = al.id) AND p."userId" = $1
           ) ${whereClause}`,
          [userId]
        ),
        query(
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
        ),
      ]);

      const total = parseInt(countResult?.count || "0", 10);
      return { albums, total, page, limit, pages: Math.ceil(total / limit) };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch albums:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
