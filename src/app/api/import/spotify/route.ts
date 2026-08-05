import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Provide a Spotify or Deezer playlist/track URL" },
      { status: 400 }
    );
  }

  // Validate URL is from supported platform
  const isSpotify = url.includes("open.spotify.com");
  const isDeezer = url.includes("deezer.com");

  if (!isSpotify && !isDeezer) {
    return NextResponse.json(
      { error: "Only Spotify and Deezer URLs are supported" },
      { status: 400 }
    );
  }

  try {
    const client = getTelegramClient();
    await client.init();

    // Send the URL to the bot - it will auto-download all tracks
    const tracks = await client.importPlaylist(url, (track) => {
      console.log(`[Import] Received: ${track.artist} - ${track.title}`);
    });

    return NextResponse.json({
      tracks: tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        messageId: t.messageId,
      })),
      count: tracks.length,
    });
  } catch (error) {
    console.error("[Import Playlist]", error);
    return NextResponse.json(
      { error: "Failed to import playlist. Make sure the URL is valid and the bot is responding." },
      { status: 500 }
    );
  }
}
