import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasSpotifyConnection } from "@/lib/spotifyAuth";

/**
 * GET /api/import/spotify/check
 *
 * Whether this user has a stored Spotify connection.
 *
 * Reads the stored connection rather than a cookie, which is what makes the
 * answer survive longer than an hour. Deliberately does *not* refresh the token
 * to check: the modal polls this on open, and spending a call to
 * accounts.spotify.com to answer "yes" is both slow and pointless — a revoked
 * token is discovered on the first real request and clears the row then.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  const connected = await hasSpotifyConnection(session.user.id!);
  return NextResponse.json({ connected });
}
