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
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = (page - 1) * limit;

  const cacheKey = `artists:list:${page}:${limit}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }
  } catch {
    // cache failure — continue to DB
  }

  try {
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "Artist"',
    );
    const total = parseInt(countResult?.count || "0", 10);

    const artists = await query(
      `SELECT
        a.*,
        COUNT(DISTINCT t.id)::int AS "trackCount",
        COUNT(DISTINCT al.id)::int AS "albumCount"
      FROM "Artist" a
      LEFT JOIN "Track" t ON t."artistId" = a.id
      LEFT JOIN "Album" al ON al."artistId" = a.id
      GROUP BY a.id
      ORDER BY a.name ASC
      LIMIT $1 OFFSET $2`,
      [limit, offset],
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
