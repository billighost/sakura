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

  try {
    const client = getTelegramClient();
    await client.init();

    // Step 2: Click the button to trigger the audio download
    const track = await client.selectResult(
      Number(buttonMessageId),
      Number(buttonIndex),
      30000
    );

    const userId = session.user.id as string;

    // Get or create artist
    let artistId: string;
    const existingArtist = await queryOne<{ id: string }>(
      `SELECT id FROM artists WHERE name = $1`,
      [track.artist]
    );

    if (existingArtist) {
      artistId = existingArtist.id;
    } else {
      const newArtist = await queryOne<{ id: string }>(
        `INSERT INTO artists (name) VALUES ($1) RETURNING id`,
        [track.artist]
      );
      artistId = newArtist!.id;
    }

    // Check if track already exists by telegramMessageId
    let dbTrack = await queryOne<{ id: string; path: string }>(
      `SELECT id, path FROM tracks WHERE "telegramMessageId" = $1`,
      [track.messageId.toString()]
    );

    if (!dbTrack) {
      // Insert new track
      dbTrack = await queryOne<{ id: string; path: string }>(
        `INSERT INTO tracks (
          title, duration, path, "telegramMessageId",
          "artistId", "addedById"
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, path`,
        [
          track.title,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
          artistId,
          userId,
        ]
      );
    }

    return NextResponse.json({
      id: dbTrack!.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      path: dbTrack!.path,
      messageId: track.messageId,
    });
  } catch (error) {
    console.error("[Telegram Select]", error);
    return NextResponse.json(
      { error: "Failed to download selected track" },
      { status: 500 }
    );
  }
}
