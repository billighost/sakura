-- Cross-device continuity + the share system.
--
-- Both tables are additive; nothing existing is altered, so this is safe to
-- apply to a live database. Written to be re-runnable (IF NOT EXISTS
-- throughout) in line with the convention the other migrations follow.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── PlaybackState ───────────────────────────────────────────────────────────
-- One row per user. Playback position and queue previously lived only in
-- localStorage, which meant they were per-browser: a queue built on a phone
-- didn't exist on a laptop, and "resume where you left off" restarted from
-- zero on every new device.
CREATE TABLE IF NOT EXISTS "PlaybackState" (
  "userId"     TEXT PRIMARY KEY,
  "trackId"    TEXT,
  "positionMs" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "isPlaying"  BOOLEAN NOT NULL DEFAULT false,

  "queue"      JSONB,
  "upNext"     JSONB,
  "queueIndex" INTEGER NOT NULL DEFAULT 0,

  "shuffle"    BOOLEAN NOT NULL DEFAULT false,
  "repeat"     TEXT NOT NULL DEFAULT 'off',

  "context"    TEXT,
  "contextId"  TEXT,

  "deviceId"   TEXT,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),

  CONSTRAINT "PlaybackState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- ── Share ───────────────────────────────────────────────────────────────────
-- Shares are durable objects, not throwaway image blobs: the link has to keep
-- working after the recipient's cache drops the picture, and open-graph
-- previews are rendered from this row server-side.
CREATE TABLE IF NOT EXISTS "Share" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "slug"      TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "kind"      TEXT NOT NULL,

  "targetId"  TEXT,
  "payload"   JSONB NOT NULL DEFAULT '{}'::jsonb,

  "theme"     TEXT NOT NULL DEFAULT 'auto',
  "views"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "expiresAt" TIMESTAMP(3),

  CONSTRAINT "Share_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Share_slug_key" ON "Share"("slug");
CREATE INDEX IF NOT EXISTS "Share_userId_idx" ON "Share"("userId");
CREATE INDEX IF NOT EXISTS "Share_kind_idx" ON "Share"("kind");
CREATE INDEX IF NOT EXISTS "Share_createdAt_idx" ON "Share"("createdAt");

-- ── Performance indexes ─────────────────────────────────────────────────────
-- These are not new-feature support; they're for queries that already exist and
-- currently sequential-scan.

-- Favorite lookups are per-user and ordered by recency on the Liked page.
CREATE INDEX IF NOT EXISTS "Favorite_userId_createdAt_idx"
  ON "Favorite"("userId", "createdAt" DESC);

-- PlaylistTrack is read ordered within a playlist on every playlist open.
CREATE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_position_idx"
  ON "PlaylistTrack"("playlistId", "position");

-- Search does `title ILIKE '%q%'`, which no btree index can serve. pg_trgm
-- makes the leading-wildcard match indexable and adds fuzzy/typo tolerance.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Track_title_trgm_idx"
  ON "Track" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Artist_name_trgm_idx"
  ON "Artist" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Album_title_trgm_idx"
  ON "Album" USING GIN ("title" gin_trgm_ops);
