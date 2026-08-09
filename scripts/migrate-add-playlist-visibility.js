/**
 * Make playlists discoverable.
 *
 * Search is being extended to return playlists alongside tracks and artists,
 * which needs an answer to "whose playlists may a stranger see?". Right now
 * there is no answer: every Playlist row is implicitly private, so a search
 * over them would either leak everyone's library or return nothing.
 *
 * `isPublic` is that answer, and it defaults to FALSE. Existing playlists stay
 * private — opting a user's data into discovery without asking is not a
 * migration, it's a privacy incident. The profile UI exposes a per-playlist
 * toggle so sharing is an explicit act.
 *
 * The partial index is deliberate: searches only ever scan public rows, so
 * indexing the private majority would be paid-for and never read.
 *
 * Run with --apply to commit.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

const DDL = `
ALTER TABLE "Playlist"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT FALSE;

-- Search reads only public playlists, newest first.
CREATE INDEX IF NOT EXISTS "Playlist_public_idx"
  ON "Playlist" ("createdAt" DESC)
  WHERE "isPublic" = TRUE;

-- Name lookup for public playlists. Trigram, to match the search endpoint's
-- similarity operator rather than forcing a prefix-only ILIKE.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Playlist_name_trgm_idx"
  ON "Playlist" USING GIN (name gin_trgm_ops)
  WHERE "isPublic" = TRUE;
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — check your .env file.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    if (!APPLY) {
      console.log("DRY RUN — no changes written. Re-run with --apply.\n");
      console.log(DDL);

      const { rows } = await pool.query(`
        SELECT COUNT(*)::int AS total FROM "Playlist"
      `);
      console.log(`\nPlaylists that would gain isPublic=false: ${rows[0].total}`);
      return;
    }

    await pool.query(DDL);
    console.log("Applied: Playlist.isPublic + discovery indexes.");

    const { rows } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE "isPublic") ::int AS public,
             COUNT(*)::int AS total
        FROM "Playlist"
    `);
    console.log(`Playlists: ${rows[0].public} public / ${rows[0].total} total.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
