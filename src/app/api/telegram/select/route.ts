import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient, type TelegramMusicClient } from "@/lib/telegram";
import { queryOne, execute } from "@/lib/sql";
import { getDeterministicTrackId } from "@/lib/deterministic";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { buttonMessageId, buttonIndex } = body;

  if (buttonMessageId === undefined || buttonIndex === undefined) {
    return NextResponse.json(
      { error: "buttonMessageId and buttonIndex are required" },
      { status: 400 }
    );
  }

  // Inside the try, so a missing worker config produces the actionable message
  // it throws rather than an unhandled rejection.
  let client: TelegramMusicClient | null = null;

  try {
    client = getTelegramClient();
    await client.acquire();

    // Step 2: Click the button to trigger the audio download
    const track = await client.selectResult(
      Number(buttonMessageId),
      Number(buttonIndex),
      30000
    );

    const artistId = (await queryOne<{ id: string }>(
      `INSERT INTO "Artist" (id, name, "createdAt")
       VALUES (gen_random_uuid()::text, $1, NOW())
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [track.artist]
    ))!.id;

    // Check if track already exists by deterministic ID or message ID
    const trackId = getDeterministicTrackId(track.title, track.artist);
    let dbTrack = await queryOne<{ id: string; audioUrl: string }>(
      `SELECT id, "audioUrl" FROM "Track" WHERE id = $1 OR "telegramMessageId" = $2 LIMIT 1`,
      [trackId, track.messageId.toString()]
    );

    if (!dbTrack) {
      // Insert new track
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `INSERT INTO "Track" (
          id, title, duration, "audioUrl", source, "telegramMessageId",
          "artistId", "createdAt"
        ) VALUES ($1, $2, $3, $4, 'telegram', $5, $6, NOW())
        RETURNING id, "audioUrl"`,
        [
          trackId,
          track.title,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
          artistId,
        ]
      );
    } else {
      // Update existing track with telegramMessageId and audioUrl if they were missing/stubbed
      await execute(
        `UPDATE "Track" 
         SET "audioUrl" = COALESCE(NULLIF("audioUrl", 'pending'), $1),
             "telegramMessageId" = COALESCE(NULLIF("telegramMessageId", '0'), $2)
         WHERE id = $3`,
        [`/api/stream/telegram/${track.messageId}`, track.messageId.toString(), dbTrack.id]
      );
    }

    return NextResponse.json({
      id: dbTrack!.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      path: dbTrack!.audioUrl,
      messageId: track.messageId,
    });
  } catch (error) {
    console.error("[Telegram Select]", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to download selected track: ${message}` },
      { status: 500 }
    );
  } finally {
    await client?.release();
  }
}
