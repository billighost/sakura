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
  const { title, artist, duration } = body;

  if (!title || !artist) {
    return NextResponse.json(
      { error: "title and artist are required" },
      { status: 400 }
    );
  }

  try {
    const client = getTelegramClient();
    await client.init();

    // Build precise search query: "artist - title"
    const query = `${artist} - ${title}`;
    console.log(`[Telegram AutoDownload] Searching: "${query}"`);

    // Step 1: Send query and wait for buttons
    const { buttonMessageId, buttons } = await client.searchMusic(query, 15000);

    if (buttons.length === 0) {
      return NextResponse.json(
        { error: "No results found on Telegram" },
        { status: 404 }
      );
    }

    // Step 2: Auto-select the first (most relevant) result
    console.log(`[Telegram AutoDownload] Got ${buttons.length} results, selecting first: "${buttons[0].text}"`);
    const track = await client.selectResult(buttonMessageId, 0, 30000);

    const userId = session.user.id as string;

    // Step 3: Get or create artist
    let artistId: string;
    const existingArtist = await queryOne<{ id: string }>(
      `SELECT id FROM "Artist" WHERE name = $1`,
      [track.artist]
    );

    if (existingArtist) {
      artistId = existingArtist.id;
    } else {
      const newArtist = await queryOne<{ id: string }>(
        `INSERT INTO "Artist" (id, name) VALUES (gen_random_uuid()::text, $1) RETURNING id`,
        [track.artist]
      );
      artistId = newArtist!.id;
    }

    // Step 4: Check if track already exists
    let dbTrack = await queryOne<{ id: string; audioUrl: string }>(
      `SELECT id, "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1`,
      [track.messageId.toString()]
    );

    if (!dbTrack) {
      // Insert new track
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", source, "telegramMessageId", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'telegram', $5, NOW())
         RETURNING id, "audioUrl"`,
        [
          track.title,
          artistId,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
        ]
      );
    }

    return NextResponse.json({
      id: dbTrack!.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      audioUrl: (dbTrack as any).audioUrl,
      messageId: track.messageId,
    });
  } catch (error) {
    console.error("[Telegram AutoDownload]", error);
    return NextResponse.json(
      { error: "Failed to download track from Telegram" },
      { status: 500 }
    );
  }
}
