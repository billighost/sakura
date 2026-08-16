/**
 * Is this `audioUrl` worth handing to a fetch or an `<audio>` element?
 *
 * Shared because the answer was previously re-derived at four call sites with
 * four slightly different string tests, and the one place that forgot the test —
 * the offline download queue — produced roughly fifty `GET
 * /api/stream/telegram/0 → 400` per session. The route was right to reject them;
 * nothing should have asked.
 *
 * The value that causes this is `/api/stream/telegram/0`, written deliberately
 * by `api/playlists/[id]/tracks/batch` as "known track, not fetched from
 * Telegram yet". It is truthy, it starts with the right prefix, and it looks
 * playable to any check that only asks whether a URL exists — which is exactly
 * why the check has to be a named function rather than a `!url` in an `if`.
 */

const TELEGRAM_STREAM_PREFIX = "/api/stream/telegram/";

/**
 * A `/api/stream/telegram/<messageId>` URL with a real message id.
 *
 * Parsed rather than string-matched: `endsWith("/0")` is the kind of test that
 * silently starts rejecting `/api/stream/telegram/0` correctly and
 * `/api/stream/telegram/00` incorrectly.
 */
export function isTelegramStreamUrl(url: string | null | undefined): boolean {
  if (!url || !url.startsWith(TELEGRAM_STREAM_PREFIX)) return false;
  const id = url.slice(TELEGRAM_STREAM_PREFIX.length).split(/[?#]/)[0];
  return /^\d+$/.test(id) && parseInt(id, 10) > 0;
}

/**
 * Playable right now, without resolving anything first.
 *
 * The three unplayable-but-truthy values this exists to catch:
 *
 *   `""` / `"pending"`   a stub row, written before the audio existed
 *   `…/telegram/0`       a known track whose Telegram message is unresolved
 *   `…dzcdn.net…`        a Deezer 30-second preview, not the track
 */
export function isPlayableAudioUrl(url: string | null | undefined): boolean {
  if (!url || url === "pending") return false;
  if (url.includes("dzcdn.net")) return false;
  if (url.startsWith(TELEGRAM_STREAM_PREFIX)) return isTelegramStreamUrl(url);
  return true;
}
