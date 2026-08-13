import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchSpotifyUserPlaylists, fetchSpotifyPlaylistWithToken } from "@/lib/spotify";

/**
 * GET /api/import/spotify/playlists
 * Returns the authenticated user's Spotify playlists.
 * Requires spotify_access_token cookie.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spotifyToken = req.cookies.get("spotify_access_token")?.value;
  if (!spotifyToken) {
    return NextResponse.json({ error: "spotify_not_connected" }, { status: 401 });
  }

  try {
    const playlists = await fetchSpotifyUserPlaylists(spotifyToken);
    return NextResponse.json({ playlists });
  } catch (error: any) {
    console.error("[Spotify Playlists] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch Spotify playlists" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/import/spotify/playlists
 * Fetches tracks for a specific Spotify playlist using the user's access token.
 * Body: { playlistId: string }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spotifyToken = req.cookies.get("spotify_access_token")?.value;
  if (!spotifyToken) {
    return NextResponse.json({ error: "spotify_not_connected" }, { status: 401 });
  }

  const { playlistId } = await req.json();
  if (!playlistId || typeof playlistId !== "string") {
    return NextResponse.json({ error: "Provide a playlistId" }, { status: 400 });
  }

  try {
    const data = await fetchSpotifyPlaylistWithToken(playlistId, spotifyToken);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[Spotify Playlist Tracks] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch playlist tracks" },
      { status: 500 }
    );
  }
}
