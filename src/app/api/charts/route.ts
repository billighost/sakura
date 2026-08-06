import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";

const CACHE_KEY = "charts:global";

export async function GET(_req: NextRequest) {
  const cached = await cacheGet<{ globalTop: unknown[] }>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  try {
    // CTE pre-aggregates play counts once instead of running a correlated
    // subquery for every row (old approach was O(N²)).
    const globalTop = await query(
      `WITH play_counts AS (
         SELECT "trackId", COUNT(*)::int AS "playCount"
         FROM "ListeningHistory"
         GROUP BY "trackId"
       )
       SELECT
         t.id, t.title, t.duration, t."audioUrl", t."coverUrl",
         COALESCE(pc."playCount", 0) AS "playCount",
         json_build_object('name', a.name, 'id', a.id) AS artist,
         json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id) AS album
       FROM "Track" t
       LEFT JOIN "Artist" a ON t."artistId" = a.id
       LEFT JOIN "Album" al ON t."albumId" = al.id
       LEFT JOIN play_counts pc ON pc."trackId" = t.id
       ORDER BY pc."playCount" DESC NULLS LAST, t."createdAt" DESC
       LIMIT 50`
    );

    const result = { globalTop };
    await cacheSet(CACHE_KEY, result, TTL.CHARTS);
    return NextResponse.json(result, { headers: { "X-Cache": "MISS" } });
  } catch (err) {
    console.error("Failed to query top charts:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
