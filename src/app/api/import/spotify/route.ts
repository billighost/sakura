import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";

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
  const isSpotify = url.includes("open.spotify.com");
  const isDeezer = url.includes("deezer.com");

  if (!isSpotify && !isDeezer) {
    return new Response(
      JSON.stringify({ error: "Only Spotify and Deezer URLs are supported" }),
      { status: 400 }
    );
  }

  const client = getTelegramClient();
  await client.acquire();

  let clientReleased = false;
  const releaseClient = async () => {
    if (!clientReleased) {
      clientReleased = true;
      await client.release();
    }
  };

  try {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await client.importPlaylist(url, (track) => {
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
