import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheDel, cacheKey } from "@/lib/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;

  // 1. Grab recent track artists to understand user's taste
  const recentTracks = await query(`
    SELECT t.id, t."artistId"
    FROM "ListeningHistory" h
    JOIN "Track" t ON h."trackId" = t.id
    WHERE h."userId" = $1
    ORDER BY h."playedAt" DESC
    LIMIT 20
  `, [userId]);

  let recommendedTrackIds: string[] = [];

  if (recentTracks.length > 0) {
    const artistIds = [...new Set(recentTracks.map(t => t.artistId))];
    
    const recommendedTracks = await query(`
      SELECT id
      FROM "Track"
      WHERE "artistId" = ANY($1)
      ORDER BY RANDOM()
      LIMIT 15
    `, [artistIds]);
    recommendedTrackIds = recommendedTracks.map(t => t.id);
  } else {
    // fallback to popular tracks if no history
    const popularTracks = await query(`
      SELECT "trackId" as id
      FROM "ListeningHistory"
      GROUP BY "trackId"
      ORDER BY COUNT(*) DESC
      LIMIT 15
    `);
    recommendedTrackIds = popularTracks.map(t => t.id);
  }

  if (recommendedTrackIds.length === 0) {
    return NextResponse.json({ error: "No tracks available to build a mix." }, { status: 400 });
  }

  // Clear old mixes
  await execute(`DELETE FROM "UserMix" WHERE "userId" = $1`, [userId]);

  // Insert a new mix
  await queryOne(`
    INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
    VALUES ($1, 'Discover Weekly', 'New music based on your listening history.', 'a', $2, NOW() + INTERVAL '7 days')
    RETURNING id
  `, [userId, recommendedTrackIds]);
  
  // Invalidate home cache
  await cacheDel(cacheKey("home", userId));

  return NextResponse.json({ ok: true, generatedCount: recommendedTrackIds.length });
}
