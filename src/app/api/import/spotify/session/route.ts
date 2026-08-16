import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cached, cacheDel, cacheKey } from "@/lib/cache";
import { fetchSpotifyProfile, fetchSpotifyUserPlaylists } from "@/lib/spotify";
import { disconnectSpotify, getSpotifyAccessToken } from "@/lib/spotifyAuth";

/**
 * GET /api/import/spotify/session
 *
 * Everything the import modal needs to render its connected state in one
 * request: whether there is a connection, whose account it is, and the playlists
 * available to import.
 *
 * One endpoint rather than three because the modal needs all of it before it can
 * show anything, and three round trips on open is three chances to render a
 * half-populated panel — which is what the old modal did (it called /check, then
 * /playlists, and flashed the connect button in between).
 *
 * DELETE on the same path disconnects.
 */

const PROFILE_TTL = 6 * 60 * 60;   // 6 h — a display name and avatar barely move.
const PLAYLIST_TTL = 5 * 60;       // 5 min — long enough to survive a modal reopen.

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  const userId = session.user.id!;

  /*
   * This both answers "is there a connection" and refreshes the access token if
   * the cached one has expired, so a stale-token disconnection is discovered
   * here — at the one moment the UI is equipped to offer a reconnect button —
   * rather than in the middle of an import.
   */
  const token = await getSpotifyAccessToken(userId);
  if (!token) {
    return NextResponse.json({ connected: false, profile: null, playlists: [] });
  }

  const [profile, playlists] = await Promise.all([
    cached(cacheKey("spotify", "profile", userId), PROFILE_TTL, () =>
      fetchSpotifyProfile(token),
    ),
    /*
     * Cached, and failure degrades to an empty list rather than a 500. A user who
     * has connected and whose playlists momentarily won't load should still see
     * that they are connected — the alternative sends them round the OAuth loop
     * to fix something that isn't broken.
     */
    cached(cacheKey("spotify", "playlists", userId), PLAYLIST_TTL, async () => {
      try {
        return await fetchSpotifyUserPlaylists(token);
      } catch (err) {
        console.error("[Spotify Session] Playlist fetch failed:", err);
        return null;
      }
    }),
  ]);

  return NextResponse.json({
    connected: true,
    profile: profile ?? null,
    playlists: playlists ?? [],
    playlistsFailed: playlists === null,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  await disconnectSpotify(userId);

  /*
   * Drop the derived caches too. Leaving them would let a reconnect to a
   * *different* Spotify account show the previous account's name and playlists
   * for up to six hours — which reads as the disconnect not having worked.
   */
  await cacheDel(
    cacheKey("spotify", "profile", userId),
    cacheKey("spotify", "playlists", userId),
  ).catch(() => {});

  return NextResponse.json({ connected: false });
}
