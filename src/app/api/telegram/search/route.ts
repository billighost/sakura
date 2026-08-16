import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient, type TelegramMusicClient } from "@/lib/telegram";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  // Inside the try: getTelegramClient() throws when the worker isn't configured,
  // and outside it that became a 500 with an empty body instead of a message
  // saying what to set.
  let client: TelegramMusicClient | null = null;

  try {
    client = getTelegramClient();
    await client.acquire();

    // Step 1: Send query and wait for bot's button response
    const { buttonMessageId, buttons } = await client.searchMusic(q, 25000);

    return NextResponse.json({
      buttonMessageId,
      buttons,
      query: q,
    });
  } catch (error) {
    console.error("[Telegram Search]", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to search music via Telegram: ${message}` },
      { status: 500 }
    );
  } finally {
    await client?.release();
  }
}
