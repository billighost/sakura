import { NextRequest } from "next/server";
import { Readable } from "stream";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";

/**
 * Proxy a Telegram message's audio as a streamable response.
 *
 * CORS and cache headers are set so the browser can serve this through the
 * audio element, the service worker can cache it, and re-winding the same
 * track doesn't re-fetch from Telegram.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messageId } = await params;
  const msgId = parseInt(messageId, 10);

  if (isNaN(msgId)) {
    return new Response("Invalid messageId", { status: 400 });
  }

  try {
    const client = getTelegramClient();
    await client.init();
    const nodeStream = await client.getAudioStream(msgId);
    const webStream = Readable.toWeb(nodeStream);

    return new Response(webStream as ReadableStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        // Long cache: a Telegram file is immutable. Let the browser and the
        // service worker keep it aggressively.
        "Cache-Control": "public, max-age=604800, immutable",
        "Accept-Ranges": "none",
      },
    });
  } catch (error) {
    console.error("[Telegram Stream]", error);
    return new Response("Failed to stream audio from Telegram", { status: 500 });
  }
}
