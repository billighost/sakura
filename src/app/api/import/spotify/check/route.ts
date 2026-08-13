import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/import/spotify/check
 * Returns whether the user has a valid Spotify access token cookie.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  const token = req.cookies.get("spotify_access_token")?.value;
  return NextResponse.json({ connected: !!token });
}
