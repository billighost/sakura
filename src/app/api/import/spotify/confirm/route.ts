import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { queryOne } from "@/lib/sql";
import { getDeterministicTrackId } from "@/lib/deterministic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { tracks } = body;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return NextResponse.json(
      { error: "Provide a tracks array with { title, artist, messageId } objects" },
      { status: 400 }
    );
  }

  const results = [];

  for (const track of tracks) {
    try {
      // Upsert artist
      const artist = await queryOne<{ id: string }>(
        `INSERT INTO "Artist" (id, name, "createdAt")
         VALUES (gen_random_uuid()::text, $1, NOW())
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [track.artist]
      );

      // Check for duplicate track by deterministic ID
      const trackId = getDeterministicTrackId(track.title, track.artist);
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM "Track" WHERE id = $1`,
        [trackId]
      );
      if (existing) {
        // If it exists, update the telegramMessageId and audioUrl if they were missing/stubbed
        await queryOne(
          `UPDATE "Track" 
           SET "audioUrl" = COALESCE(NULLIF("audioUrl", 'pending'), $1),
               "telegramMessageId" = COALESCE(NULLIF("telegramMessageId", '0'), $2)
           WHERE id = $3`,
          [`/api/stream/telegram/${track.messageId}`, String(track.messageId), trackId]
        );
        results.push({ ...track, status: "exists", trackId: existing.id });
        continue;
      }

      // Insert track with deterministic ID
      const newTrack = await queryOne<{ id: string }>(
        `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", source, "telegramMessageId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, 'telegram', $6, NOW())
         RETURNING id`,
        [
          trackId,
          track.title,
          artist!.id,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          String(track.messageId),
        ]
      );

      results.push({ ...track, status: "created", trackId: newTrack!.id });
    } catch (err) {
      console.error(`Failed to import track "${track.title}":`, err);
      results.push({ ...track, status: "error" });
    }
  }

  return NextResponse.json({ results });
}
