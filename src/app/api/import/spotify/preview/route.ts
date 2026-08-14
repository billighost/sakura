import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchSpotifyPlaylist } from "@/lib/spotify";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Provide a valid URL" }, { status: 400 });
  }

  // If the user has previously authenticated with Spotify via OAuth, use their
  // personal access token. This is necessary for:
  //   1. Private/collaborative playlists that client credentials can't access.
  //   2. Apps in Spotify's Development Mode — public API calls still return 403
  //      unless the requesting token belongs to an allowlisted tester account.
  const userSpotifyToken = req.cookies.get("spotify_access_token")?.value ?? undefined;

  try {
    const isSpotify = url.includes("open.spotify.com") || url.includes("spotify.link");
    
    if (isSpotify) {
      const data = await fetchSpotifyPlaylist(url, userSpotifyToken);
      return NextResponse.json(data);
    }
    
    return NextResponse.json({ error: "Only Spotify URLs are supported for preview" }, { status: 400 });
  } catch (error: any) {
    console.error("[Spotify Preview Error]", error);
    return NextResponse.json({ error: error.message || "Failed to fetch playlist preview" }, { status: 500 });
  }
}
