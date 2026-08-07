-- Give every text primary key a database-level default.
--
-- Prisma's `@default(uuid())` is generated in the *client*, not the database,
-- so the columns were created as plain `TEXT NOT NULL`. That's fine for code
-- going through Prisma, but this app talks to Postgres directly with `pg` for
-- almost everything — and any raw INSERT that omitted "id" failed with a
-- not-null violation. That silently broke:
--   • UserMix inserts        → "Made for you" was permanently empty
--   • SystemPlaylist inserts → Top 50 charts never populated
--   • UserSettings upserts   → settings failed for users with no row yet
--
-- Setting a DB default fixes every current and future raw insert at once, and
-- is transparent to Prisma (which keeps supplying its own uuid).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'UserSettings', 'Artist', 'Album', 'Track', 'Playlist',
    'PlaylistFolder', 'TrackCredit', 'SampledTrack', 'ListeningHistory',
    'UserMix', 'SystemPlaylist', 'TasteFeedback'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'id' AND data_type = 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text', t
      );
    END IF;
  END LOOP;
END $$;
