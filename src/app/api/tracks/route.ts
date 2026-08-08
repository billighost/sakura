import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cached, cacheKey as buildKey, TTL } from "@/lib/cache";

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

  /**
   * Read through the shared cache rather than talking to Redis directly.
   *
   * Going straight to `redis.get` skipped the in-process L1 layer entirely, so
   * this endpoint paid a network round trip on every single call even when the
   * answer had not changed — and on a per-command plan that round trip is the
   * bill. It also had no single-flight, so an expiry under load sent every
   * concurrent reader to Postgres at once for the same page.
   */
  const key = buildKey("tracks:list", page, limit, q, String(downloadedOnly));

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
    const result = await cached(key, TTL.TRACKS, async () => {
      // The count and the page are independent; running them in sequence cost
      // two full round trips to a remote database to answer one request.
      const [countResult, tracks] = await Promise.all([
        queryOne<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "Track" t LEFT JOIN "Artist" a ON t."artistId" = a.id LEFT JOIN "Album" al ON t."albumId" = al.id ${whereClause}`,
          [...params],
        ),
        query(
          `${baseQuery} ORDER BY t."createdAt" DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset],
        ),
      ]);

      const total = parseInt(countResult?.count || "0", 10);
      return { tracks, total, page, limit, pages: Math.ceil(total / limit) };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch tracks:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
