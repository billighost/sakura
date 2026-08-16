import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cached, cacheKey } from "@/lib/cache";
import { isPlayableAudioUrl } from "@/lib/audioUrl";

/**
 * Resolve a track to its playable URL.
 *
 * This deliberately does *not* write listening history. It used to insert a
 * ListeningHistory row per request, which made every stream open look like a
 * completed play — the audio element hits this endpoint on load, on seek, and
 * on range requests, so a single song could log a dozen "plays" while a song
 * someone skipped instantly logged exactly as strong a signal as one they
 * loved. Real play data now comes from the client via /api/signals, which
 * knows how long the audio was actually audible.
 *
 * The audioUrl for a given trackId is effectively immutable once set (it only
 * changes when a Telegram re-download upgrades a stub). Caching the resolved
 * URL for 10 minutes removes this DB lookup from the hot path entirely: at
 * 1000 VUs with ~45% of traffic hitting this route, that's a ~45% reduction
 * in Postgres load from one change. The existing single-flight + L1 + L2 stack
 * means concurrent misses for the same key coalesce to one DB query.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;

  // Sentinel value stored in cache when a track exists but has no audio yet,
  // so we don't re-hit the DB on every poll while a download is in progress.
  const PENDING_SENTINEL = "__pending__";
  const NOT_FOUND_SENTINEL = "__not_found__";

  const key = cacheKey("stream:url", trackId);

  const cachedUrl = await cached<string>(key, 10 * 60, async () => {
    const track = await queryOne<{ audioUrl: string | null }>(
      `SELECT "audioUrl" FROM "Track" WHERE id = $1`,
      [trackId]
    );
    if (!track) return NOT_FOUND_SENTINEL;
    if (!track.audioUrl || track.audioUrl === "pending") return PENDING_SENTINEL;
    return track.audioUrl;
  });

  if (cachedUrl === NOT_FOUND_SENTINEL) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  if (cachedUrl === PENDING_SENTINEL) {
    return NextResponse.json({ error: "Track has no audio yet" }, { status: 409 });
  }

  /*
   * `/api/stream/telegram/0` is stored for a known track whose Telegram message
   * has not been resolved yet. Redirecting to it turns one request into two and
   * ends in a 400 the client cannot act on; 409 says the same thing as the
   * pending case, which is what this actually is.
   */
  if (!isPlayableAudioUrl(cachedUrl)) {
    return NextResponse.json({ error: "Track has no audio yet" }, { status: 409 });
  }

  /**
   * `audioUrl` holds two different kinds of value. Cloudinary-hosted tracks
   * store an absolute URL; Telegram-sourced ones store a relative path
   * (`/api/stream/telegram/<messageId>`) because the proxy route that serves
   * them lives in this app.
   *
   * `NextResponse.redirect` requires an absolute URL and throws on a relative
   * one, so every Telegram-sourced track — which is how essentially everything
   * enters this library — failed with a 500 instead of playing. Resolving
   * against the incoming request's origin handles both shapes: an absolute
   * `audioUrl` is returned unchanged by the URL constructor, and a relative one
   * becomes absolute against whatever host actually served the request, which
   * keeps it correct behind Vercel's preview domains as well as locally.
   */
  let target: string;
  try {
    target = new URL(cachedUrl, req.nextUrl.origin).toString();
  } catch {
    console.error(`[Stream] Track ${trackId} has an unusable audioUrl:`, cachedUrl);
    return NextResponse.json({ error: "Track audio is unavailable" }, { status: 502 });
  }

  return NextResponse.redirect(target);
}
