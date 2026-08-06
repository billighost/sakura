import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheDel, cacheKey } from "@/lib/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  await generateUserMixes(userId);
  return NextResponse.json({ ok: true });
}

export async function generateUserMixes(userId: string) {
  // Clear old mixes
  await execute(`DELETE FROM "UserMix" WHERE "userId" = $1`, [userId]);

  // 1. Get Top Artists & Genres for this user (ignore skipped tracks)
  const topArtistsResult = await query(`
    SELECT t."artistId", a.genres
    FROM "ListeningHistory" h
    JOIN "Track" t ON h."trackId" = t.id
    LEFT JOIN "Artist" a ON t."artistId" = a.id
    WHERE h."userId" = $1 AND h.skipped = false
    GROUP BY t."artistId", a.genres
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `, [userId]);

  const topArtistIds = topArtistsResult.map((r: any) => r.artistId);
  const userGenres = Array.from(new Set(topArtistsResult.flatMap((r: any) => r.genres || [])));

  // Generate 1: Recent Rotations (15 songs)
  const recentRotations = await query(`
    SELECT "trackId" as id
    FROM "ListeningHistory"
    WHERE "userId" = $1 AND skipped = false
    GROUP BY "trackId"
    ORDER BY COUNT(*) DESC, MAX("playedAt") DESC
    LIMIT 15
  `, [userId]);

  if (recentRotations.length > 0) {
    await execute(`
      INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
      VALUES ($1, 'Based on your recent rotations', 'Songs you can''t get enough of lately.', 'a', $2, NOW() + INTERVAL '7 days')
    `, [userId, recentRotations.map((r: any) => r.id)]);
  }

  // Generate 2: Feeling Adventurous (20 songs)
  if (userGenres.length > 0) {
    const adventurousTracks = await query(`
      SELECT t.id
      FROM "Track" t
      JOIN "Artist" a ON t."artistId" = a.id
      WHERE a.genres && $1::text[]
      AND t."artistId" != ALL($2::text[])
      AND t.id NOT IN (SELECT "trackId" FROM "ListeningHistory" WHERE "userId" = $3)
      ORDER BY RANDOM()
      LIMIT 20
    `, [userGenres, topArtistIds, userId]);

    if (adventurousTracks.length > 0) {
      await execute(`
        INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
        VALUES ($1, 'Feeling adventurous', 'Discover new artists and sounds you haven''t heard before.', 'b', $2, NOW() + INTERVAL '7 days')
      `, [userId, adventurousTracks.map((r: any) => r.id)]);
    }
  }

  // Generate 3: Time Machine (15 songs)
  if (topArtistIds.length > 0) {
    const timeMachineTracks = await query(`
      SELECT t.id
      FROM "Track" t
      LEFT JOIN "Album" al ON t."albumId" = al.id
      WHERE t."artistId" = ANY($1::text[])
      AND (al."releaseYear" < EXTRACT(YEAR FROM NOW()) - 5 OR t."createdAt" < NOW() - INTERVAL '2 years')
      ORDER BY RANDOM()
      LIMIT 15
    `, [topArtistIds]);

    if (timeMachineTracks.length > 0) {
      await execute(`
        INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
        VALUES ($1, 'Time Machine', 'Throwback classics from your favorite artists.', 'a', $2, NOW() + INTERVAL '7 days')
      `, [userId, timeMachineTracks.map((r: any) => r.id)]);
    }
  }

  // Generate 4: Under the Radar (15 songs)
  if (userGenres.length > 0) {
    const underRadarTracks = await query(`
      SELECT t.id
      FROM "Track" t
      JOIN "Artist" a ON t."artistId" = a.id
      WHERE a.genres && $1::text[]
      AND t.id NOT IN (
        SELECT "trackId" FROM "ListeningHistory" GROUP BY "trackId" ORDER BY COUNT(*) DESC LIMIT 100
      )
      ORDER BY RANDOM()
      LIMIT 15
    `, [userGenres]);

    if (underRadarTracks.length > 0) {
      await execute(`
        INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
        VALUES ($1, 'Under the Radar', 'Hidden gems and lesser-known tracks from your favorite genres.', 'b', $2, NOW() + INTERVAL '7 days')
      `, [userId, underRadarTracks.map((r: any) => r.id)]);
    }
  }

  // Generate 5: Time of Day Mix
  const hour = new Date().getHours();
  let timeLabel = "Anytime Mix";
  let timeDesc = "Songs for any time of the day.";
  let timeTint = "a";

  if (hour >= 6 && hour < 12) {
    timeLabel = "Morning Focus";
    timeDesc = "Start your day right with these tracks.";
    timeTint = "b";
  } else if (hour >= 12 && hour < 17) {
    timeLabel = "Afternoon Boost";
    timeDesc = "Keep your energy up through the afternoon.";
    timeTint = "a";
  } else if (hour >= 17 && hour < 22) {
    timeLabel = "Evening Wind Down";
    timeDesc = "Relax and unwind with these smooth tracks.";
    timeTint = "b";
  } else {
    timeLabel = "Late Night Vibes";
    timeDesc = "Deep focus and night-time grooves.";
    timeTint = "a";
  }

  const timeOfDayTracks = await query(`
    SELECT "trackId" as id
    FROM "ListeningHistory"
    WHERE "userId" = $1 AND skipped = false
    GROUP BY "trackId"
    ORDER BY RANDOM()
    LIMIT 15
  `, [userId]);

  if (timeOfDayTracks.length > 0) {
    await execute(`
      INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
      VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
    `, [userId, timeLabel, timeDesc, timeTint, timeOfDayTracks.map((r: any) => r.id)]);
  }

  // Fallback for new users
  if (recentRotations.length === 0) {
    const popularTracks = await query(`
      SELECT "trackId" as id
      FROM "ListeningHistory"
      GROUP BY "trackId"
      ORDER BY COUNT(*) DESC
      LIMIT 15
    `);
    
    if (popularTracks.length > 0) {
      await execute(`
        INSERT INTO "UserMix" ("userId", label, description, tint, "trackIds", "expiresAt")
        VALUES ($1, 'Starter Mix', 'Popular tracks to get you started.', 'a', $2, NOW() + INTERVAL '7 days')
      `, [userId, popularTracks.map((r: any) => r.id)]);
    }
  }

  // Invalidate home cache
  await cacheDel(cacheKey("home", userId));
}
