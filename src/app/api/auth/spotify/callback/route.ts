import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveSpotifyConnection } from "@/lib/spotifyAuth";

/**
 * GET /api/auth/spotify/callback
 *
 * Receives Spotify's authorization code, exchanges it for tokens with the PKCE
 * verifier from the cookie, stores the connection, and redirects back.
 *
 * This used to keep the access token in a cookie with `maxAge: expires_in` and
 * discard the refresh token. That is why "connected" evaporated after an hour —
 * see lib/spotifyAuth.ts. The tokens now go to the database and no Spotify
 * credential is handed to the browser at all.
 */

/**
 * Where to send the browser afterwards, from the `state` we round-tripped.
 *
 * `state` originates as the `redirectBack` query param on /api/auth/spotify, so
 * it is caller-supplied — and `new URL(state, origin)` happily leaves the origin
 * when `state` is absolute. `https://evil.example/` as a redirectBack would have
 * bounced the user off-site from a URL on our domain, which is the shape of an
 * open redirect worth phishing with. Only a path on this origin is accepted;
 * anything else falls back to /library.
 */
function safeReturn(state: string | null, origin: string): URL {
  const fallback = new URL("/library", origin);
  if (!state || !state.startsWith("/") || state.startsWith("//")) return fallback;
  try {
    const url = new URL(state, origin);
    return url.origin === new URL(origin).origin ? url : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const origin = req.nextUrl.origin;
  const state = searchParams.get("state");

  /** The return URL, carrying one outcome param the import modal reads. */
  const back = (outcome: Record<string, string>) => {
    const url = safeReturn(state, origin);
    for (const [k, v] of Object.entries(outcome)) url.searchParams.set(k, v);
    return url;
  };

  if (error || !code) {
    return NextResponse.redirect(back({ spotify_error: error ?? "cancelled" }));
  }

  const verifier = req.cookies.get("spotify_pkce_verifier")?.value;
  if (!verifier) {
    return NextResponse.redirect(back({ spotify_error: "verifier_missing" }));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const redirectUri = `${origin}/api/auth/spotify/callback`;

  // Exchange code + verifier for access token
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    console.error("[Spotify OAuth] Token exchange failed:", tokenRes.status, body);
    return NextResponse.redirect(back({ spotify_error: "token_exchange_failed" }));
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error("[Spotify OAuth] Token response had no access_token");
    return NextResponse.redirect(back({ spotify_error: "token_exchange_failed" }));
  }

  /*
   * Awaited, and a write failure is surfaced rather than swallowed. If this row
   * does not land the user is not connected, whatever the redirect says — and
   * silently claiming success is how the previous version's hourly amnesia read
   * as a mystery instead of a bug.
   */
  try {
    await saveSpotifyConnection(session.user.id!, tokenData);
  } catch (err) {
    console.error("[Spotify OAuth] Failed to store connection:", err);
    return NextResponse.redirect(back({ spotify_error: "storage_failed" }));
  }

  const response = NextResponse.redirect(back({ spotify_connected: "1" }));

  // The verifier is single-use and spent.
  response.cookies.delete("spotify_pkce_verifier");

  /*
   * Clear the cookie the old implementation set. Without this, a user who
   * connected before this change carries a stale `spotify_access_token` that no
   * route reads any more — harmless, but it is a Spotify credential sitting in a
   * browser for no reason, and it should not outlive the code that used it.
   */
  response.cookies.delete("spotify_access_token");

  return response;
}
