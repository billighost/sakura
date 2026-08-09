import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { queryOne } from "@/lib/sql";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { buttonMessageId, buttonIndex, title, artist, duration } = body;

  if (buttonMessageId === undefined || buttonIndex === undefined) {
    return NextResponse.json(
      { error: "buttonMessageId and buttonIndex are required" },
      { status: 400 }
    );
  }

  const client = getTelegramClient();
  await client.acquire();

  try {
    // Step 2: Click the button to trigger the audio download
    const track = await client.selectResult(
      Number(buttonMessageId),
      Number(buttonIndex),
      30000
    );

    const userId = session.user.id as string;

    const artistId = (await queryOne<{ id: string }>(
      `INSERT INTO "Artist" (id, name, "createdAt")
       VALUES (gen_random_uuid()::text, $1, NOW())
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [track.artist]
    ))!.id;

    // Check if track already exists by telegramMessageId
    let dbTrack = await queryOne<{ id: string; audioUrl: string }>(
      `SELECT id, "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1`,
      [track.messageId.toString()]
    );

    if (!dbTrack) {
      // Insert new track
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `INSERT INTO "Track" (
          id, title, duration, "audioUrl", source, "telegramMessageId",
          "artistId", "createdAt"
        ) VALUES (gen_random_uuid()::text, $1, $2, $3, 'telegram', $4, $5, NOW())
        RETURNING id, "audioUrl"`,
        [
          track.title,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
          artistId,
        ]
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
    return NextResponse.json(
      { error: "Failed to download selected track" },
      { status: 500 }
    );
  } finally {
    await client.release();
  }
}
