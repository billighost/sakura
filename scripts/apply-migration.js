// Applies a raw .sql migration file straight through the pg driver.
//
// Prisma 7 dropped `--schema` from `prisma db execute` (config now comes from
// prisma.config.ts), and `prisma migrate deploy` wants a shadow database this
// project doesn't provision.
//
//   node scripts/apply-migration.js prisma/migrations/<name>/migration.sql
//
// With no argument it applies every migration under prisma/migrations in
// lexicographic order (= timestamp order, given Prisma's naming), recording
// each in a `_migrations` table so already-applied ones are skipped.
//
// A named file is always applied, recorded or not — the migrations in this
// repo are written to be re-runnable (IF NOT EXISTS / ON CONFLICT throughout),
// so re-applying one deliberately is safe and useful for verifying idempotence.
// The original `20260804231333_init` predates that convention and is not
// re-runnable, which is exactly why the ledger exists.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

function collectMigrationFiles(explicitPath) {
  if (explicitPath) return [path.resolve(explicitPath)];

  const root = path.resolve(__dirname, "..", "prisma", "migrations");
  if (!fs.existsSync(root)) return [];

  return fs
    .readdirSync(root)
    .filter((dir) => fs.statSync(path.join(root, dir)).isDirectory())
    .sort()
    .map((dir) => path.join(root, dir, "migration.sql"))
    .filter((file) => fs.existsSync(file));
}

async function run() {
  const explicit = process.argv[2];
  const files = collectMigrationFiles(explicit);
  if (files.length === 0) {
    console.error("No migration files found.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — check your .env file.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Anything created before this ledger existed is assumed applied — the
    // schema is demonstrably already there.
    const { rows } = await client.query(`SELECT name FROM "_migrations"`);
    const applied = new Set(rows.map((r) => r.name));
    if (applied.size === 0) {
      const exists = await client.query(
        `SELECT to_regclass('public."User"') IS NOT NULL AS present`
      );
      if (exists.rows[0].present) {
        await client.query(
          `INSERT INTO "_migrations" (name) VALUES ('20260804231333_init')
           ON CONFLICT DO NOTHING`
        );
        applied.add("20260804231333_init");
      }
    }

    console.log(`Connected. ${files.length} migration file(s) found.\n`);
    let ran = 0;

    for (const file of files) {
      const label = path.basename(path.dirname(file));

      if (!explicit && applied.has(label)) {
        console.log(`  ${label} … skipped (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(file, "utf8");
      process.stdout.write(`  ${label} … `);

      // One transaction per file: a migration either lands whole or not at all.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_migrations" (name) VALUES ($1) ON CONFLICT DO NOTHING`,
          [label]
        );
        await client.query("COMMIT");
        console.log("ok");
        ran++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw err;
      }
    }

    console.log(ran === 0 ? "\nNothing to do — database is up to date." : `\nApplied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
