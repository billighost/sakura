import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { scheduleCdnPromotion } from "@/lib/audioOffload";
import { queryOne } from "@/lib/sql";

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
/**
 * Never let this response be treated as static. A rangeless request returns the
 * whole file, and anything that wants to hash or buffer the body to make it
 * cacheable has to read all of it first — which shows up as a request that
 * sends nothing for two minutes and then flushes 11MB at once.
 */
export const dynamic = "force-dynamic";

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

  const client = getTelegramClient();
  let clientAcquired = false;
  let clientReleased = false;
  const releaseClient = async () => {
    if (clientAcquired && !clientReleased) {
      clientReleased = true;
      await client.release();
    }
  };

  try {
    /**
     * A track that has been promoted to the CDN is stored with an absolute
     * Cloudinary URL, so its proxy URL is dead weight: replaying a Range
     * request here pulls the bytes from Telegram all over again when the CDN
     * would answer from a nearby edge for a fraction of the latency.
     * Redirecting keeps both the stream and the promotion path honest —
     * `/api/stream/<trackId>` already does exactly this for the same reason.
     *
     * `.catch(() => null)` is not defensive noise. This lookup is an
     * optimisation, and Neon closes idle connections aggressively enough that
     * `Connection terminated unexpectedly` is a normal event here — letting it
     * propagate turned a recoverable blip into a 500 on a request that could
     * have been served perfectly well from Telegram.
     */
    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      const cdnHit = await queryOne<{ audioUrl: string | null }>(
        `SELECT "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1 LIMIT 1`,
        [messageId],
      ).catch(() => null);
      if (cdnHit?.audioUrl && /^https?:\/\/res\.cloudinary\.com\//i.test(cdnHit.audioUrl)) {
        return new Response(null, { status: 307, headers: { Location: cdnHit.audioUrl } });
      }
    }

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

    await client.acquire();
    clientAcquired = true;

    /**
     * Probe the size before streaming when a Range was asked for.
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
      await releaseClient();
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    nodeStream.on("close", () => {
      releaseClient().catch(err => console.error("[Telegram Stream] Release error on close:", err));
    });
    nodeStream.on("end", () => {
      releaseClient().catch(err => console.error("[Telegram Stream] Release error on end:", err));
    });
    nodeStream.on("error", (err) => {
      console.error("[Telegram Stream] Node stream error:", err);
      releaseClient().catch(e => console.error("[Telegram Stream] Release error on error:", e));
    });

    const webStream = Readable.toWeb(nodeStream);

    const headers = new Headers({
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=604800, immutable",
      "Accept-Ranges": "bytes",
    });

    /**
     * Answer as `206 Partial Content` whenever the size is known, even for a
     * request that sent no Range header.
     *
     * A rangeless `200` was buffered whole before a single byte left the server:
     * first byte at 25.6s, then all 9MB flushed in 30ms. The byte-identical 206
     * branch — same iterator, same parameters, same offset 0 — began at 2.4s and
     * streamed steadily. Serving a full-extent 206 (`bytes 0-<size-1>/<size>`)
     * is a legal response to a rangeless GET given `Accept-Ranges: bytes`, and
     * every consumer here (audio elements, the offline download queue's fetch)
     * handles it, so the whole-file case now takes the path that streams.
     *
     * Falls through to the plain 200 below only when the size is unknown, where
     * no valid Content-Range can be built.
     */
    const asPartial = offsetBytes !== undefined || size > 0;

    if (asPartial) {
      const rangeStart = offsetBytes ?? 0;
      // Clamp to the last byte that exists. A client may ask for more than the
      // file holds (`bytes=0-99999999`); the correct answer is what we have,
      // not a length we cannot deliver.
      const lastByte = size > 0 ? size - 1 : undefined;
      let endPos = requestedEnd;
      if (endPos === undefined) endPos = lastByte;
      else if (lastByte !== undefined) endPos = Math.min(endPos, lastByte);

      if (endPos !== undefined) {
        headers.set("Content-Length", String(endPos - rangeStart + 1));
        headers.set("Content-Range", `bytes ${rangeStart}-${endPos}/${size > 0 ? size : "*"}`);
      } else {
        // Unknown total size — send the range open-ended rather than guessing.
        headers.set("Content-Range", `bytes ${rangeStart}-/*`);
      }

      /**
       * Promotion has to be scheduled here too, not only on the whole-file path.
       * Audio elements essentially always send a Range header, so gating
       * promotion on a rangeless request meant the CDN hand-off almost never
       * fired for the one traffic source it exists to remove — tracks stayed on
       * the proxy indefinitely, paying host bandwidth on every replay.
       */
      scheduleCdnPromotion(msgId);

      return new Response(webStream as ReadableStream, {
        status: 206,
        headers,
      });
    }

    /**
     * Deliberately no `Content-Length` on the rangeless response.
     *
     * Setting it made Next buffer the entire body before sending anything: the
     * first byte arrived at 25.6s and all 9MB flushed in the following 30ms,
     * while the byte-identical 206 branch started at 2.4s and streamed steadily.
     * Omitting it lets the response go out chunked, which is what a
     * player-facing audio stream needs. `size` is still reported to range
     * requests via Content-Range, so seeking keeps working.
     */
    scheduleCdnPromotion(msgId);

    return new Response(webStream as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    await releaseClient();
    console.error("[Telegram Stream]", error);
    return new Response("Failed to stream audio from Telegram", { status: 500 });
  }
}
