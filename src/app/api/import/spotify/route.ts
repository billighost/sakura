import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";

const spotifyUrlInfo = require("spotify-url-info");
const spotify = spotifyUrlInfo(fetch);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = await req.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return new Response(
      JSON.stringify({ error: "Provide a Spotify or Deezer playlist/track URL" }),
      { status: 400 }
    );
  }

  // Validate URL is from supported platform
  const isSpotify = url.includes("open.spotify.com") || url.includes("spotify.link");
  const isDeezer = url.includes("deezer.com");

  if (!isSpotify && !isDeezer) {
    return new Response(
      JSON.stringify({ error: "Only Spotify and Deezer URLs are supported" }),
      { status: 400 }
    );
  }

  // For Deezer, we still use Telegram bot
  const useTelegram = !isSpotify;
  let client: any = null;
  let clientReleased = false;

  const releaseClient = async () => {
    if (useTelegram && client && !clientReleased) {
      clientReleased = true;
      await client.release();
    }
  };

  try {
    if (useTelegram) {
      client = getTelegramClient();
      await client.acquire();
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isSpotify) {
            console.log(`[Import] Fetching Spotify metadata for ${url}`);
            const data = await spotify.getData(url);
            const tracks = data.trackList || (data.type === 'track' ? [data] : []);
            
            for (const track of tracks) {
              const title = track.title || track.name;
              const artist = track.subtitle || (track.artists ? track.artists[0]?.name : "Unknown");
              console.log(`[Import] Received from Spotify: ${artist} - ${title}`);
              
              // track.duration is usually in ms for Spotify
              const duration = track.duration ? Math.floor(track.duration / 1000) : 0;
              
              const dataStr = JSON.stringify({
                title,
                artist,
                duration,
                messageId: 0, // Not downloaded yet
              });
              controller.enqueue(new TextEncoder().encode(`data: ${dataStr}\n\n`));
            }
            controller.enqueue(new TextEncoder().encode(`event: done\ndata: {}\n\n`));
            controller.close();
          } else {
            // Telegram bot import (e.g. for Deezer)
            await client.importPlaylist(url, (track: any) => {
              console.log(`[Import] Received: ${track.artist} - ${track.title}`);
              const data = JSON.stringify({
                title: track.title,
                artist: track.artist,
                duration: track.duration,
                messageId: track.messageId,
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            });
            controller.enqueue(new TextEncoder().encode(`event: done\ndata: {}\n\n`));
            controller.close();
          }
        } catch (err: any) {
          console.error("[Import Playlist Stream Error]", err);
          controller.error(err);
        } finally {
          await releaseClient();
        }
      },
      async cancel() {
        await releaseClient();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    await releaseClient();
    console.error("[Import Playlist]", error);
    return new Response(
      JSON.stringify({ error: "Failed to import playlist." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
