import { after } from "next/server";
import { queryOne, execute } from "./sql";
import { acquireLock, releaseLock, cacheDel, cacheKey } from "./cache";
import { uploadAudioStream } from "./cloudinary";
import { getTelegramClient } from "./telegram";

/**
 * Move Telegram-sourced audio onto the CDN, once per track, for good.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/api/stream/telegram/[messageId]` pipes the audio through the server, so
 * every play of every track spends host bandwidth. That does not scale on a
 * free plan and it doesn't fail gracefully: Vercel Hobby allows 100 GB a month,
 * and a thousand listeners playing twenty ~4 MB songs a day is ~80 GB a *day*.
 * The site would go dark on day two, and the failure mode is a billing wall
 * rather than something you can cache your way out of after the fact.
 *
 * The fix is not "find a CDN with a big enough free tier" — no free tier serves
 * terabytes of audio, and pretending otherwise just moves the wall. It's to
 * change what the host pays *per*. Proxying costs bandwidth per play, per
 * listener, forever. Promoting the file to Cloudinary on its first play costs
 * bandwidth once per track, globally, and every subsequent play is served by
 * the CDN and never touches this app at all. For a 189-track library that's
 * roughly 760 MB spent once, instead of unbounded egress.
 *
 * The promotion is deliberately *not* in the request path. Playback must not
 * wait on an upload, so it runs in `after()` and the listener who triggered it
 * is served by the proxy exactly as before. Only later plays get the CDN URL.
 *
 * WHAT MAKES IT SAFE TO RUN ON EVERY PLAY
 * ---------------------------------------
 * It is idempotent and mutually exclusive. The DB check short-circuits once a
 * track has been promoted, so the steady state costs one indexed lookup. A
 * Redis lock keeps concurrent first-plays — the common case for a newly
 * released song — from all uploading the same file. And the `public_id` is
 * derived from the message id, so even a lock that expires mid-upload
 * overwrites one object rather than accumulating copies.
 */

/** Cloudinary's free tier rejects single files above this; skip rather than fail. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Long enough to cover a slow upload of a large file on a cold connection. */
const LOCK_SECONDS = 1200;

function isCdnUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\/res\.cloudinary\.com\//i.test(url);
}

/**
 * Promote one track's audio to the CDN if it hasn't been already.
 *
 * Returns quietly in every failure case. This is an optimisation running behind
 * a response that has already been sent; a Telegram hiccup or a Cloudinary
 * quota error must not turn into a visible problem, and the next play will
 * simply try again.
 */
export async function promoteToCdn(messageId: number): Promise<void> {
  if (!Number.isFinite(messageId) || messageId <= 0) return;

  const track = await queryOne<{ id: string; audioUrl: string | null }>(
    `SELECT id, "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1 LIMIT 1`,
    [String(messageId)],
  ).catch(() => null);

  // No row means nothing references this message — there is nothing to point
  // at a CDN copy, so uploading would just consume quota for no reader.
  if (!track) return;
  if (isCdnUrl(track.audioUrl)) return;

  const lockKey = `lock:cdn-promote:${messageId}`;
  if (!(await acquireLock(lockKey, LOCK_SECONDS))) return;

  try {
    // Re-check under the lock: another instance may have finished between the
    // read above and the acquire, and re-uploading would be pure waste.
    const fresh = await queryOne<{ audioUrl: string | null }>(
      `SELECT "audioUrl" FROM "Track" WHERE id = $1`,
      [track.id],
    );
    if (isCdnUrl(fresh?.audioUrl)) return;

    const client = getTelegramClient();
    await client.acquire();
    try {
      const { stream, size } = await client.getAudioStream(messageId);

      if (size > MAX_UPLOAD_BYTES) {
        console.warn(
          `[cdn] Track ${track.id} is ${Math.round(size / 1048576)}MB — above the ` +
            `${MAX_UPLOAD_BYTES / 1048576}MB upload limit; leaving it on the proxy path`,
        );
        stream.destroy?.();
        return;
      }

      const { url, bytes } = await uploadAudioStream(stream, `tg-${messageId}`);

      // Only now is the CDN copy real. Writing the URL earlier would point
      // listeners at an object that might never finish uploading.
      await execute(`UPDATE "Track" SET "audioUrl" = $1 WHERE id = $2`, [url, track.id]);

      // The old proxy URL is embedded in cached track payloads all over the app.
      await cacheDel(cacheKey("track", track.id));

      console.log(
        `[cdn] Promoted track ${track.id} (msg ${messageId}, ${Math.round(bytes / 1024)}KB) — ` +
          `future plays bypass this server`,
      );
    } finally {
      await client.release();
    }
  } catch (err) {
    console.error(
      `[cdn] Promotion failed for message ${messageId}:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    await releaseLock(lockKey);
  }
}

/**
 * Schedule promotion after the current response completes.
 *
 * `after()` rather than a floating promise: on a serverless host the runtime
 * can be frozen the moment the response flushes, which would abandon a
 * detached upload part-way — the exact bug this codebase already fixed once for
 * chart refreshes.
 */
export function scheduleCdnPromotion(messageId: number): void {
  after(async () => {
    await promoteToCdn(messageId);
  });
}
