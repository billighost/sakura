import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/auth/spotify/callback
 *
 * Receives Spotify's authorization code, exchanges it for an access token
 * using the PKCE verifier stored in the cookie, then stores the token in a
 * short-lived cookie and redirects back to the app.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state") ?? "/library";

  if (error || !code) {
    const redirectUrl = new URL(state, req.nextUrl.origin);
    redirectUrl.searchParams.set("spotify_error", error ?? "cancelled");
    return NextResponse.redirect(redirectUrl);
  }

  const verifier = req.cookies.get("spotify_pkce_verifier")?.value;
  if (!verifier) {
    const redirectUrl = new URL(state, req.nextUrl.origin);
    redirectUrl.searchParams.set("spotify_error", "verifier_missing");
    return NextResponse.redirect(redirectUrl);
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const redirectUri = `${req.nextUrl.origin}/api/auth/spotify/callback`;

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
    const redirectUrl = new URL(state, req.nextUrl.origin);
    redirectUrl.searchParams.set("spotify_error", "token_exchange_failed");
    return NextResponse.redirect(redirectUrl);
  }

  const tokenData = await tokenRes.json();
  const accessToken: string = tokenData.access_token;
  const expiresIn: number = tokenData.expires_in ?? 3600;

  // Redirect back with token in a short-lived HttpOnly cookie
  const redirectUrl = new URL(state, req.nextUrl.origin);
  redirectUrl.searchParams.set("spotify_connected", "1");
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set("spotify_access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: expiresIn,
    path: "/",
  });

  // Clear the verifier cookie
  response.cookies.delete("spotify_pkce_verifier");

  return response;
}
