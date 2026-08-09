import { NextRequest } from "next/server";
import { Readable } from "stream";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { scheduleCdnPromotion } from "@/lib/audioOffload";

/**
 * Proxy a Telegram message's audio as a streamable response.
 *
 * CORS and cache headers are set so the browser can serve this through the
 * audio element, the service worker can cache it, and re-winding the same
 * track doesn't re-fetch from Telegram.
 *
 * This route is the fallback path, not the destination. Every byte served here
 * is host bandwidth, which does not scale — so a full request also schedules
 * the track's promotion to the CDN, after which `Track.audioUrl` points at
 * Cloudinary and playback stops reaching this server at all. See
 * `lib/audioOffload.ts`.
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
    /**
     * Parse the Range header.
     *
     * Only a single `bytes=start-[end]` range is supported, which is what audio
     * elements and the offline download queue actually send. A suffix range
     * (`bytes=-500`) is deliberately not matched here and falls through to a
     * whole-file response, which is a legal — if unhelpful — answer.
     */
    const rangeHeader = req.headers.get("Range");
    let offsetBytes: number | undefined;
    let requestedEnd: number | undefined;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        if (Number.isFinite(start) && start >= 0) {
          offsetBytes = start;
          if (match[2]) {
            const end = parseInt(match[2], 10);
            if (Number.isFinite(end)) requestedEnd = end;
          }
        }
      }
    }

    // A backwards range (`bytes=500-100`) is malformed. RFC 7233 says to ignore
    // an unsatisfiable-because-malformed Range and serve the whole entity.
    if (offsetBytes !== undefined && requestedEnd !== undefined && requestedEnd < offsetBytes) {
      offsetBytes = undefined;
      requestedEnd = undefined;
    }

    const client = getTelegramClient();
    await client.init();

    /**
     * Probe the size before streaming when a Range was asked for.
     *
     * The previous version computed `size - offsetBytes` unconditionally, so an
     * offset past the end of the file produced a *negative* Content-Length and a
     * Content-Range whose start exceeded its end — a response strict HTTP
     * clients reject outright at the parser ("Invalid character in
     * Content-Length"), killing the connection rather than failing the request.
     *
     * That is not a hypothetical: the offline download queue resumes by sending
     * `Range: bytes=<savedBytes>-`, so any partial download whose saved length
     * had caught up with the real file hit exactly this. The client is written
     * to handle a 416 by discarding its partial data and restarting — it never
     * got the chance, because the server sent a corrupt 206 instead.
     */
    const { stream: nodeStream, size } = await client.getAudioStream(
      msgId,
      offsetBytes,
      offsetBytes !== undefined && requestedEnd !== undefined
        ? requestedEnd - offsetBytes + 1
        : undefined,
    );

    if (offsetBytes !== undefined && size > 0 && offsetBytes >= size) {
      // Unsatisfiable: tell the client the real size so it can restart correctly.
      nodeStream.destroy?.();
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const webStream = Readable.toWeb(nodeStream);

    const headers = new Headers({
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=604800, immutable",
      "Accept-Ranges": "bytes",
    });

    if (offsetBytes !== undefined) {
      // Clamp to the last byte that exists. A client may ask for more than the
      // file holds (`bytes=0-99999999`); the correct answer is what we have,
      // not a length we cannot deliver.
      const lastByte = size > 0 ? size - 1 : undefined;
      let endPos = requestedEnd;
      if (endPos === undefined) endPos = lastByte;
      else if (lastByte !== undefined) endPos = Math.min(endPos, lastByte);

      if (endPos !== undefined) {
        headers.set("Content-Length", String(endPos - offsetBytes + 1));
        headers.set("Content-Range", `bytes ${offsetBytes}-${endPos}/${size > 0 ? size : "*"}`);
      } else {
        // Unknown total size — send the range open-ended rather than guessing.
        headers.set("Content-Range", `bytes ${offsetBytes}-/*`);
      }

      return new Response(webStream as ReadableStream, {
        status: 206,
        headers,
      });
    }

    if (size > 0) {
      headers.set("Content-Length", String(size));
    }

    // Only whole-file requests schedule promotion. A Range request is a seek or
    // a browser probe, and firing on those would attempt the upload repeatedly
    // during a single listen — the lock would absorb it, but at the cost of a
    // Redis round trip per seek for no benefit.
    scheduleCdnPromotion(msgId);

    return new Response(webStream as ReadableStream, {
      status: 200,
      headers,
    });  } catch (error) {
    console.error("[Telegram Stream]", error);
    return new Response("Failed to stream audio from Telegram", { status: 500 });
  }
}
