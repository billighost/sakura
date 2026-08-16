import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { LinkError, resolveMusicLink } from "@/lib/importLink";

/**
 * POST /api/import/spotify/preview
 *
 * Kept for the callers that already point at it, but the work now happens in
 * `lib/importLink.ts` — the same resolver `/api/import/link` uses. What changed:
 *
 *   - Deezer links are accepted (this used to reject them by hostname);
 *   - track and album links work, not only playlists;
 *   - the keyless embed engine is tried before the Web API, so a user whose
 *     account isn't on the Spotify app's allowlist gets tracks instead of a 403;
 *   - a failure to resolve is a 422 with something the user can act on, rather
 *     than a 500 carrying a provider's internal message.
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
    return NextResponse.json({ error: "Provide a valid URL" }, { status: 400 });
  }

  const spotifyToken = req.cookies.get("spotify_access_token")?.value ?? undefined;

  try {
    const resolved = await resolveMusicLink(url, { spotifyToken });
    return NextResponse.json(resolved);
  } catch (err) {
    if (err instanceof LinkError) {
      return NextResponse.json({ error: err.message, attempts: err.attempts }, { status: 422 });
    }
    console.error("[import/preview]", err);
    return NextResponse.json(
      { error: "Something went wrong reading that link. Try again in a moment." },
      { status: 500 }
    );
  }
}
