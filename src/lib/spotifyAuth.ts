import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { execute, queryOne } from "./sql";

/**
 * Durable Spotify connections.
 *
 * The problem this solves, precisely: the OAuth callback exchanged the code for
 * `{ access_token, refresh_token, expires_in }`, stored the access token in a
 * cookie with `maxAge: expires_in`, and dropped the refresh token on the floor.
 * An hour later the cookie expired and the app had no way to get another token,
 * so it showed "Connect Spotify" again — and kept doing that every hour, which
 * looked like the UI failing to remember something it had never been given.
 *
 * The refresh token now lives in Postgres, so "connected" is a fact about the
 * account rather than about one browser's cookie jar: it survives the hour, a
 * cookie clear, a different device, and a redeploy.
 *
 * Everything here takes a `userId` and returns a token or null. No route needs
 * to know about refreshing, rotation, or expiry.
 */

// ── Token encryption ────────────────────────────────────────────────────────

/*
 * A Spotify refresh token is a long-lived bearer credential for someone's real
 * Spotify account. It is not our secret to store carelessly, and unlike the
 * password hashes in the next table over it is not a one-way digest — whatever
 * is in the column is the credential.
 *
 * AES-256-GCM with a key derived from NEXTAUTH_SECRET. GCM rather than CBC
 * because it authenticates: a tampered ciphertext fails to decrypt instead of
 * decrypting to garbage that then gets sent to Spotify as a token.
 *
 * The honest limit of this: the key is derived from an environment variable that
 * sits next to DATABASE_URL, so it does not protect against someone who has the
 * whole environment. What it does protect against is the realistic leak — a
 * database dump, a snapshot, a query pasted into a chat window, an over-broad
 * read replica credential. That is worth 40 lines.
 *
 * Rotating NEXTAUTH_SECRET invalidates every stored connection. That is
 * recoverable (users reconnect with one click) and it is handled: a decrypt
 * failure deletes the row rather than throwing, so the app degrades to "not
 * connected" instead of erroring.
 */

const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required to store Spotify tokens — refusing to write a " +
        "refresh token in plaintext.",
    );
  }
  return createHash("sha256").update(secret).digest().subarray(0, KEY_LENGTH);
}

function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    payload.toString("base64url"),
  ].join(":");
}

function decryptToken(stored: string): string | null {
  try {
    const [ivB64, tagB64, payloadB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !payloadB64) return null;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key (NEXTAUTH_SECRET rotated) or a tampered value. Either way the
    // token is unusable; the caller treats null as "not connected".
    return null;
  }
}

// ── Storage ─────────────────────────────────────────────────────────────────

interface ConnectionRow {
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

export interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Store the result of a code exchange or a refresh.
 *
 * `refresh_token` is optional on purpose: Spotify usually rotates it and returns
 * a new one, but not always. When it is absent the existing one stays valid, so
 * COALESCE keeps it rather than overwriting it with null — getting this wrong
 * would disconnect the user on their first successful refresh.
 */
export async function saveSpotifyConnection(
  userId: string,
  token: SpotifyTokenResponse,
): Promise<void> {
  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);

  await execute(
    `INSERT INTO "SpotifyConnection"
       ("userId", "refreshToken", "accessToken", "expiresAt", "scope", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT ("userId") DO UPDATE SET
       "refreshToken" = COALESCE($2, "SpotifyConnection"."refreshToken"),
       "accessToken"  = $3,
       "expiresAt"    = $4,
       "scope"        = COALESCE($5, "SpotifyConnection"."scope"),
       "updatedAt"    = NOW()`,
    [
      userId,
      token.refresh_token ? encryptToken(token.refresh_token) : null,
      encryptToken(token.access_token),
      expiresAt,
      token.scope ?? null,
    ],
  );
}

export async function disconnectSpotify(userId: string): Promise<void> {
  await execute(`DELETE FROM "SpotifyConnection" WHERE "userId" = $1`, [userId]);
}

/** True when the user has a stored connection, without spending a Spotify call. */
export async function hasSpotifyConnection(userId: string): Promise<boolean> {
  const row = await queryOne<{ present: boolean }>(
    `SELECT TRUE AS present FROM "SpotifyConnection" WHERE "userId" = $1`,
    [userId],
  );
  return !!row;
}

// ── The one function routes call ────────────────────────────────────────────

/**
 * Refresh a minute early. Clock skew between us, Vercel's edge, and Spotify is
 * unbounded in principle and a few seconds in practice; handing back a token
 * that expires mid-request produces a 401 that looks like a disconnection.
 */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A usable Spotify access token for this user, or null if they aren't connected.
 *
 * Uses the cached access token while it is fresh, otherwise spends the refresh
 * token and persists whatever comes back. Never throws for the ordinary failure
 * modes — a route's job is to say "not connected", not to 500 because Spotify
 * was slow.
 */
export async function getSpotifyAccessToken(userId: string): Promise<string | null> {
  const row = await queryOne<ConnectionRow>(
    `SELECT "refreshToken", "accessToken", "expiresAt", "scope"
       FROM "SpotifyConnection" WHERE "userId" = $1`,
    [userId],
  );
  if (!row) return null;

  const fresh =
    row.accessToken &&
    row.expiresAt &&
    new Date(row.expiresAt).getTime() - EXPIRY_SKEW_MS > Date.now();

  if (fresh) {
    const plain = decryptToken(row.accessToken!);
    if (plain) return plain;
    // Access token undecryptable but the refresh token might not be — fall
    // through and try to mint a new one before giving up on the connection.
  }

  const refreshToken = decryptToken(row.refreshToken);
  if (!refreshToken) {
    console.warn(
      `[Spotify] Stored refresh token for user ${userId} could not be decrypted ` +
        `(NEXTAUTH_SECRET changed?) — clearing the connection.`,
    );
    await disconnectSpotify(userId).catch(() => {});
    return null;
  }

  return refreshAccessToken(userId, refreshToken);
}

async function refreshAccessToken(
  userId: string,
  refreshToken: string,
): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error("[Spotify] SPOTIFY_CLIENT_ID is not set — cannot refresh.");
    return null;
  }

  /*
   * The PKCE flow's refresh grant is public-client: client_id in the body, no
   * client_secret. Sending a secret here is not merely unnecessary, it fails —
   * the token was issued to a public client and Spotify rejects the mismatch.
   */
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  let res: Response;
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    // Network trouble or a timeout. The connection is almost certainly still
    // valid, so leave the row alone and let the next request try again.
    console.error("[Spotify] Refresh request failed:", err);
    return null;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");

    /*
     * `invalid_grant` is Spotify saying the refresh token is dead — revoked in
     * the user's account settings, or the app's authorization withdrawn. Retrying
     * will never work, so drop the row: the modal then honestly offers to
     * reconnect instead of failing silently on every visit.
     *
     * Any other status (429, 5xx, a timeout upstream) is transient and the row
     * is kept.
     */
    if (res.status === 400 && detail.includes("invalid_grant")) {
      console.warn(`[Spotify] Refresh token for user ${userId} was revoked — disconnecting.`);
      await disconnectSpotify(userId).catch(() => {});
      return null;
    }

    console.error(`[Spotify] Refresh returned ${res.status}: ${detail.slice(0, 200)}`);
    return null;
  }

  const token = (await res.json()) as SpotifyTokenResponse;
  if (!token.access_token) return null;

  await saveSpotifyConnection(userId, token).catch((err) =>
    // The token in hand is good even if we failed to cache it; the cost of a
    // failed write is one extra refresh next request, not a broken response.
    console.error("[Spotify] Failed to persist refreshed token:", err),
  );

  return token.access_token;
}
