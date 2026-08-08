import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { cachedWithStale, cacheKey, TTL } from "@/lib/cache";
import { searchTracksITunes } from "@/lib/metadata";

/**
 * High-performance load testing entry point.
 * Simulates different backend operation actions (DB queries, Redis caching,
 * external API calls) to evaluate concurrency limits of the Neon database pool
 * and Upstash Redis caches without NextAuth session overhead.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "health";

  try {
    if (action === "search") {
      // 1. Trigram similarity Postgres query + iTunes search provider lookup
      const q = searchParams.get("q") || "taylor";
      const limit = 10;
      const term = q.trim();

      const localPromise = query(
        `SELECT t.id, t."deezerId", t.title, t."audioUrl"
           FROM "Track" t
           JOIN "Artist" a ON a.id = t."artistId"
          WHERE t.title % $1
          LIMIT $2`,
        [term, limit]
      ).catch(() => []);

      const searchPromise = cachedWithStale(
        cacheKey("search", term.toLowerCase(), limit),
        TTL.search,
        async () => {
          const itunes = await searchTracksITunes(term, limit);
          return { tracks: itunes, total: itunes.length };
        },
        { label: "search" }
      );

      const [localTracks, searchResult] = await Promise.all([localPromise, searchPromise]);
      return NextResponse.json({ success: true, localTracksCount: localTracks.length, searchResult });
    }

    if (action === "db") {
      // 2. Direct database query to measure Postgres pool performance
      const tracks = await query(`SELECT id, title, duration FROM "Track" LIMIT 50`);
      return NextResponse.json({ success: true, count: tracks.length });
    }

    if (action === "redis") {
      // 3. Redis / Layer 1 caching test
      const key = cacheKey("test-load-key", Math.floor(Math.random() * 50));
      const val = await cachedWithStale(key, 10, async () => {
        return { data: "cached-data-block" };
      });
      return NextResponse.json({ success: true, val });
    }

    // Default: light health query
    const tracksCount = await query(`SELECT COUNT(*)::int as count FROM "Track"`);
    return NextResponse.json({ success: true, action, tracksCount: tracksCount[0]?.count || 0 });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
