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
  const q = searchParams.get("q") || "";
  const downloadedOnly = searchParams.get("downloaded") === "true";
  const offset = (page - 1) * limit;

  const cacheKey = `tracks:list:${page}:${limit}:${q}:${downloadedOnly}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "X-Cache": "HIT" },
      });
    }
  } catch {
    // cache failure — continue to DB
  }

  let whereClause = "";
  const params: any[] = [];
  let paramIdx = 1;

  if (q) {
    whereClause = `WHERE t.title ILIKE $${paramIdx} OR a.name ILIKE $${paramIdx} OR al.title ILIKE $${paramIdx}`;
    params.push(`%${q}%`);
    paramIdx++;
  }

  const baseQuery = `
    SELECT
      t.id, t.title, t.duration, t."trackNumber", t.genre, t."audioUrl", t."coverUrl",
      json_build_object('name', a.name, 'id', a.id) AS artist,
      json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id) AS album,
      COALESCE(
        (SELECT json_agg(json_build_object('name', a2.name, 'id', a2.id, 'role', ta.role))
         FROM "TrackArtist" ta
         JOIN "Artist" a2 ON ta."artistId" = a2.id
         WHERE ta."trackId" = t.id),
        '[]'::json
      ) AS "otherArtists"
    FROM "Track" t
    LEFT JOIN "Artist" a ON t."artistId" = a.id
    LEFT JOIN "Album" al ON t."albumId" = al.id
    ${whereClause}
  `;

  try {
    const countParams = [...params];
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Track" t LEFT JOIN "Artist" a ON t."artistId" = a.id LEFT JOIN "Album" al ON t."albumId" = al.id ${whereClause}`,
      countParams,
    );
    const total = parseInt(countResult?.count || "0", 10);

    params.push(limit, offset);
    const tracks = await query(
      `${baseQuery} ORDER BY t."createdAt" DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params,
    );

    const result = { tracks, total, page, limit, pages: Math.ceil(total / limit) };

    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: 60 });
    } catch {
      // cache write failure — non-critical
    }

    return NextResponse.json(result, {
      headers: { "X-Cache": "MISS" },
    });
  } catch (err) {
    console.error("Failed to fetch tracks:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
