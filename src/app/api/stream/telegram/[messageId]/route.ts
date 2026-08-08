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

  if (isNaN(msgId) || msgId <= 0) {
    return new Response("Invalid messageId", { status: 400 });
  }

  try {
    const rangeHeader = req.headers.get("Range");
    let offsetBytes: number | undefined;
    let limitBytes: number | undefined;
    
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(.*)/);
      if (match) {
        offsetBytes = parseInt(match[1], 10);
        if (match[2]) {
          const end = parseInt(match[2], 10);
          limitBytes = end - offsetBytes + 1;
        }
      }
    }

    const client = getTelegramClient();
    await client.init();
    
    const { stream: nodeStream, size } = await client.getAudioStream(msgId, offsetBytes, limitBytes);
    const webStream = Readable.toWeb(nodeStream);

    const headers = new Headers({
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=604800, immutable",
      "Accept-Ranges": "bytes",
    });

    if (size > 0) {
      const length = limitBytes ? limitBytes : (size - (offsetBytes || 0));
      headers.set("Content-Length", length.toString());
    }

    if (offsetBytes !== undefined) {
      const endPos = limitBytes ? offsetBytes + limitBytes - 1 : (size > 0 ? size - 1 : "*");
      const totalSize = size > 0 ? size : "*";
      headers.set("Content-Range", `bytes ${offsetBytes}-${endPos}/${totalSize}`);
      
      return new Response(webStream as ReadableStream, {
        status: 206,
        headers,
      });
    }

    return new Response(webStream as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[Telegram Stream]", error);
    return new Response("Failed to stream audio from Telegram", { status: 500 });
  }
}
