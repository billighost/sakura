import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { LinkError, resolveMusicLink } from "@/lib/importLink";
import { getSpotifyAccessToken } from "@/lib/spotifyAuth";

/**
 * POST /api/import/link — resolve a pasted Spotify or Deezer link into tracks.
 *
 * Provider-neutral on purpose. The old route was `/api/import/spotify/preview`,
 * which said Spotify in its path, refused Deezer links outright, and only
 * understood playlist URLs. Everything about *which* provider and *what kind* of
 * link this is now belongs to `lib/importLink.ts`, along with the fallback chain
 * — so a track link, an album link, a `spotify:` URI and a share-sheet short link
 * all arrive here and get answered the same way.
 *
 * The preview route still exists and delegates here, so nothing that already
 * calls it breaks.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a url." }, { status: 400 });
  }

  if (!url || typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Paste a link to import." }, { status: 400 });
  }

  /*
   * Present when the user has connected Spotify. It's one engine in the chain
   * rather than the first thing tried: a personal token is the only way to read a
   * *private* playlist, but for everything else the keyless engine is both faster
   * and immune to the Development-Mode allowlist that 403s most accounts.
   */
  const spotifyToken = (await getSpotifyAccessToken(session.user.id!)) ?? undefined;

  try {
    const resolved = await resolveMusicLink(url, { spotifyToken });
    return NextResponse.json(resolved);
  } catch (err) {
    if (err instanceof LinkError) {
      // 422, not 500: the request was fine, the link couldn't be resolved.
      return NextResponse.json(
        { error: err.message, attempts: err.attempts },
        { status: 422 }
      );
    }
    console.error("[import/link]", err);
    return NextResponse.json(
      { error: "Something went wrong reading that link. Try again in a moment." },
      { status: 500 }
    );
  }
}
