-- Durable Spotify connections
--
-- The OAuth callback exchanged the authorization code for tokens and then threw
-- the refresh token away, storing only the access token in a cookie with
-- `maxAge: expires_in` — one hour. So "Connect Spotify" worked, and an hour
-- later the app had no idea the user had ever connected: the import modal showed
-- the connect button again, and it did that every hour, forever. This was read
-- as a UI bug ("remember the logged-in state"), but there was nothing for the UI
-- to remember — the credential that makes a connection durable was discarded at
-- the moment it was issued.
--
-- One row per user. A user has at most one Spotify account connected, and the
-- natural key is the user, so `userId` is the primary key rather than a surrogate
-- id with a unique index on top of it — the same shape as UserSettings.
--
-- Tokens are stored encrypted (AES-256-GCM, key derived from NEXTAUTH_SECRET);
-- see lib/spotifyAuth.ts. The column is TEXT because the ciphertext is stored as
-- `iv:tag:payload` base64url triples, not bytes — it survives a pg_dump to a
-- text file, which is how this database gets backed up.
--
-- `accessToken` and `expiresAt` are a cache, not state: they can be dropped at
-- any time and the next request mints a new pair from the refresh token. They
-- exist so the common case — a page load inside the hour — costs zero calls to
-- accounts.spotify.com.
--
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "SpotifyConnection" (
  "userId"       UUID        PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "refreshToken" TEXT        NOT NULL,
  "accessToken"  TEXT,
  "expiresAt"    TIMESTAMPTZ,
  "scope"        TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spotify rotates the refresh token on most refreshes, so the row is written on
-- every refresh, not just on connect. Nothing here is queried by anything but
-- `userId`, which the primary key already covers — no further indexes.
