import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/auth/spotify
 *
 * Initiates Spotify OAuth 2.0 PKCE flow. Generates a code verifier and
 * challenge, stores the verifier in a short-lived cookie, then redirects
 * to Spotify's authorization page.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Spotify not configured" }, { status: 500 });
  }

  // Generate PKCE code verifier (43–128 chars of URL-safe random bytes)
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/spotify/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "playlist-read-private playlist-read-collaborative",
    // Pass redirectBack so callback can send user back to origin page
    state: req.nextUrl.searchParams.get("redirectBack") ?? "/library",
  });

  const response = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );

  // Store verifier in HttpOnly cookie (5 min TTL)
  response.cookies.set("spotify_pkce_verifier", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  return response;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const randomValues = new Uint8Array(64);
  crypto.getRandomValues(randomValues);
  for (const v of randomValues) {
    result += chars[v % chars.length];
  }
  return result;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
