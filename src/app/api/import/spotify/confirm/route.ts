import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, queryOne } from "@/lib/sql";

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

  const userId = session.user.id as string;
  const results = [];

  for (const track of tracks) {
    try {
      // Upsert artist
      let artist = await queryOne<{ id: string }>(
        `SELECT id FROM "Artist" WHERE name = $1`,
        [track.artist]
      );
      if (!artist) {
        artist = await queryOne<{ id: string }>(
          `INSERT INTO "Artist" (id, name) VALUES (gen_random_uuid()::text, $1) RETURNING id`,
          [track.artist]
        );
      }

      // Check for duplicate track by title + artist
      const existing = await queryOne<{ id: string }>(
        `SELECT t.id FROM "Track" t WHERE t.title = $1 AND t."artistId" = $2`,
        [track.title, artist!.id]
      );
      if (existing) {
        results.push({ ...track, status: "exists", trackId: existing.id });
        continue;
      }

      // Insert track
      const newTrack = await queryOne<{ id: string }>(
        `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", source, "telegramMessageId", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'telegram', $5, NOW())
         RETURNING id`,
        [
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
