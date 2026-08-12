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

  try {
    const isSpotify = url.includes("open.spotify.com") || url.includes("spotify.link");
    
    if (isSpotify) {
      const data = await fetchSpotifyPlaylist(url);
      return NextResponse.json(data);
    }
    
    return NextResponse.json({ error: "Only Spotify URLs are supported for preview" }, { status: 400 });
  } catch (error: any) {
    console.error("[Spotify Preview Error]", error);
    return NextResponse.json({ error: error.message || "Failed to fetch playlist preview" }, { status: 500 });
  }
}
