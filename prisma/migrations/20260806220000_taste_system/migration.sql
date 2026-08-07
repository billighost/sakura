-- ── Taste system ────────────────────────────────────────────────────────────
-- Written to be re-runnable: every statement is IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS so applying it twice against a partially-migrated database is safe.

-- 1. Graded play signals on ListeningHistory ---------------------------------
-- `skipped` is declared in schema.prisma but was never created by the initial
-- migration — the schema and the database had drifted. Every query filtering
-- on `h.skipped` (the old mix generator did, on all five of its queries) was
-- therefore failing outright, which is one of the reasons "Made for you" was
-- always empty. Add it here alongside the new signal columns.
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "skipped"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "msPlayed"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "skipAtMs"  INTEGER;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "context"   TEXT;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "contextId" TEXT;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "autoplay"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "hourOfDay" INTEGER;
ALTER TABLE "ListeningHistory" ADD COLUMN IF NOT EXISTS "dayOfWeek" INTEGER;

CREATE INDEX IF NOT EXISTS "ListeningHistory_userId_playedAt_idx" ON "ListeningHistory"("userId", "playedAt");
CREATE INDEX IF NOT EXISTS "ListeningHistory_userId_trackId_idx" ON "ListeningHistory"("userId", "trackId");

-- 2. TasteProfile ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TasteProfile" (
  "userId"          TEXT PRIMARY KEY,
  "onboarded"       BOOLEAN NOT NULL DEFAULT false,
  "seedArtistIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "seedGenres"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "seedArtistNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "topGenres"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "topArtistIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "discovery"       DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  "eraCenter"       INTEGER,
  "eraSpread"       INTEGER,
  "avgTrackMs"      INTEGER,
  "skipRate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalPlays"      INTEGER NOT NULL DEFAULT 0,
  "vector"          JSONB,
  "computedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TasteProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3. ArtistAffinity ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ArtistAffinity" (
  "userId"       TEXT NOT NULL,
  "artistId"     TEXT NOT NULL,
  "score"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "plays"        INTEGER NOT NULL DEFAULT 0,
  "completions"  INTEGER NOT NULL DEFAULT 0,
  "skips"        INTEGER NOT NULL DEFAULT 0,
  "likes"        INTEGER NOT NULL DEFAULT 0,
  "lastPlayedAt" TIMESTAMP(3),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArtistAffinity_pkey" PRIMARY KEY ("userId", "artistId"),
  CONSTRAINT "ArtistAffinity_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "User"("id")   ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ArtistAffinity_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ArtistAffinity_userId_score_idx" ON "ArtistAffinity"("userId", "score");
CREATE INDEX IF NOT EXISTS "ArtistAffinity_artistId_idx"     ON "ArtistAffinity"("artistId");

-- 4. GenreAffinity -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "GenreAffinity" (
  "userId"    TEXT NOT NULL,
  "genre"     TEXT NOT NULL,
  "score"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "plays"     INTEGER NOT NULL DEFAULT 0,
  "skips"     INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenreAffinity_pkey" PRIMARY KEY ("userId", "genre"),
  CONSTRAINT "GenreAffinity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "GenreAffinity_userId_score_idx" ON "GenreAffinity"("userId", "score");

-- 5. TasteFeedback -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TasteFeedback" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "target"    TEXT NOT NULL,
  "targetId"  TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TasteFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TasteFeedback_userId_target_targetId_key" ON "TasteFeedback"("userId", "target", "targetId");
CREATE INDEX IF NOT EXISTS "TasteFeedback_userId_idx" ON "TasteFeedback"("userId");

-- 6. Richer UserMix ----------------------------------------------------------
ALTER TABLE "UserMix" ADD COLUMN IF NOT EXISTS "kind"       TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE "UserMix" ADD COLUMN IF NOT EXISTS "slot"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserMix" ADD COLUMN IF NOT EXISTS "subtitle"   TEXT;
ALTER TABLE "UserMix" ADD COLUMN IF NOT EXISTS "coverUrls"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserMix" ADD COLUMN IF NOT EXISTS "seedGenres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "UserMix_userId_kind_slot_idx" ON "UserMix"("userId", "kind", "slot");

-- 7. Supporting indexes for recommendation queries ---------------------------
CREATE INDEX IF NOT EXISTS "Track_genre_idx"        ON "Track"("genre");
CREATE INDEX IF NOT EXISTS "Artist_genres_gin_idx"  ON "Artist" USING GIN ("genres");
CREATE INDEX IF NOT EXISTS "Album_releaseYear_idx"  ON "Album"("releaseYear");
