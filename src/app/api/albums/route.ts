import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const downloadedOnly = searchParams.get("downloaded") === "true";
  const offset = (page - 1) * limit;

  const cacheKey = `albums:list:${page}:${limit}:${downloadedOnly}`;
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
      whereClause = `WHERE EXISTS (
        SELECT 1 FROM "Track" t WHERE t."albumId" = al.id
      )`;
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Album" al ${whereClause}`,
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
      ${whereClause}
      GROUP BY al.id, a.name, a.id
      ORDER BY al.title ASC
      LIMIT $1 OFFSET $2`,
      [limit, offset],
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
