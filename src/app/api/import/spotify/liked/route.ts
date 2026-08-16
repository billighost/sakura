import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cached, cacheKey } from "@/lib/cache";
import { fetchSpotifySavedTracks } from "@/lib/spotify";
import { getSpotifyAccessToken } from "@/lib/spotifyAuth";

/**
 * GET /api/import/spotify/liked
 *
 * The connected account's Liked Songs — the one source that isn't a playlist and
 * so has no shareable URL. Pasting a link cannot reach it; this endpoint is the
 * only way it gets imported, which is most of the argument for connecting an
 * account at all.
 *
 * Needs the `user-library-read` scope. A connection made before that scope was
 * requested will 403 here; the response says `reconnect: true` so the modal can
 * offer the one action that fixes it instead of showing a raw Spotify error.
 */

const LIKED_TTL = 5 * 60;

/** What one request will fetch. See fetchSpotifySavedTracks for why it's capped. */
const MAX_LIKED = 200;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getSpotifyAccessToken(session.user.id!);
  if (!token) {
    return NextResponse.json({ error: "spotify_not_connected" }, { status: 401 });
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "", 10) || MAX_LIKED, 1),
    MAX_LIKED,
  );

  try {
    const data = await cached(
      cacheKey("spotify", "liked", session.user.id!, limit),
      LIKED_TTL,
      () => fetchSpotifySavedTracks(token, limit),
    );

    return NextResponse.json({
      tracks: data?.tracks ?? [],
      total: data?.total ?? 0,
      /*
       * True when the library is larger than what was fetched. The UI needs to
       * be able to say "the 200 most recent of your 4,312 liked songs" — showing
       * 200 of 4,312 with no qualifier is a lie the user only discovers after
       * importing.
       */
      truncated: (data?.total ?? 0) > (data?.tracks.length ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("403")) {
      return NextResponse.json(
        {
          error: "Reconnect Spotify to allow reading your Liked Songs.",
          reconnect: true,
        },
        { status: 403 },
      );
    }

    console.error("[Spotify Liked] Error:", err);
    return NextResponse.json({ error: "Failed to load Liked Songs" }, { status: 500 });
  }
}
