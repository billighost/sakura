/**
 * Two storage migrations, applied together.
 *
 * A. ListeningHistory.id : text UUID → BIGSERIAL
 *    The column is 37 bytes plus a 47-byte index entry, has never once been
 *    scanned (`idx_scan = 0`), and nothing anywhere holds a foreign key to it —
 *    it exists only because Prisma requires an @id. A bigint identity costs 8
 *    bytes and an 18-byte index entry, saving ~58 B per row on the table that
 *    dominates the storage budget. The old values are discarded rather than
 *    converted precisely because nothing references them.
 *
 * B. The User id cluster : text → native uuid
 *    User.id and every userId foreign key that points at it. 37 bytes → 16, and
 *    every index carrying one of those columns shrinks by the same 21 bytes.
 *    On ListeningHistory, userId appears in two indexes, so that is another
 *    ~63 B per row.
 *
 * Deliberately NOT touched: anything in the Track.id graph. `Track.id` holds
 * values like `deezer-3937670811` (the download path mints them that way), so
 * it is not a UUID column and never was. Casting it would fail, and "fixing"
 * the values would silently break every reference to them — including the
 * virtual chart entries. That blocks trackId everywhere, which is why this
 * migration is narrower than it first looks.
 *
 * Everything runs in one transaction. Run with --apply to commit.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const UUID_RE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // A migration that stalls behind a live query should fail fast, not wedge
    // the table for every request while it waits.
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    await client.query(`SET LOCAL statement_timeout = '300s'`);

    const sizeBefore = Number(
      (await client.query(`SELECT pg_database_size(current_database()) b`)).rows[0].b
    );

    // ── Discover the User FK graph rather than hardcoding it ────────────────
    const { rows: userFks } = await client.query(`
      SELECT tc.constraint_name AS name, tc.table_name AS child, kcu.column_name AS col,
             rc.delete_rule AS on_delete
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_name = 'User' AND ccu.column_name = 'id'
       ORDER BY tc.table_name
    `);

    console.log(`\n  User is referenced by ${userFks.length} foreign keys:`);
    for (const f of userFks) console.log(`    ${f.child}.${f.col}  (ON DELETE ${f.on_delete})`);

    // ── Safety gate: every value must parse as a UUID ───────────────────────
    const targets = [{ table: "User", col: "id" }, ...userFks.map((f) => ({ table: f.child, col: f.col }))];
    let dirty = 0;
    for (const t of targets) {
      const [{ bad }] = (
        await client.query(
          `SELECT COUNT(*)::int bad FROM "${t.table}" WHERE "${t.col}" IS NOT NULL AND "${t.col}" !~ $1`,
          [UUID_RE]
        )
      ).rows;
      if (bad > 0) {
        console.log(`    ✖ ${t.table}.${t.col} has ${bad} non-UUID values`);
        dirty += bad;
      }
    }
    if (dirty > 0) {
      throw new Error(`${dirty} non-UUID values found — refusing to convert`);
    }
    console.log(`  ✓ all ${targets.length} columns contain only UUID-shaped values`);

    // ── A. ListeningHistory.id → BIGSERIAL ──────────────────────────────────
    const incoming = (
      await client.query(`
      SELECT COUNT(*)::int n
        FROM information_schema.constraint_column_usage ccu
        JOIN information_schema.table_constraints tc ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'ListeningHistory' AND ccu.column_name = 'id'`)
    ).rows[0].n;
    if (incoming > 0) throw new Error(`ListeningHistory.id has ${incoming} inbound FKs — cannot drop`);

    console.log(`\n  A. ListeningHistory.id → bigint identity (no inbound FKs ✓)`);
    await client.query(`ALTER TABLE "ListeningHistory" DROP CONSTRAINT IF EXISTS "ListeningHistory_pkey"`);
    await client.query(`ALTER TABLE "ListeningHistory" DROP COLUMN IF EXISTS "id"`);
    await client.query(`ALTER TABLE "ListeningHistory" ADD COLUMN "id" BIGINT GENERATED ALWAYS AS IDENTITY`);
    await client.query(`ALTER TABLE "ListeningHistory" ADD CONSTRAINT "ListeningHistory_pkey" PRIMARY KEY ("id")`);

    // ── B. User cluster → uuid ──────────────────────────────────────────────
    console.log(`  B. User.id and ${userFks.length} userId columns → uuid`);
    for (const f of userFks) {
      await client.query(`ALTER TABLE "${f.child}" DROP CONSTRAINT "${f.name}"`);
    }
    await client.query(`ALTER TABLE "User" ALTER COLUMN "id" TYPE uuid USING "id"::uuid`);
    for (const f of userFks) {
      await client.query(
        `ALTER TABLE "${f.child}" ALTER COLUMN "${f.col}" TYPE uuid USING "${f.col}"::uuid`
      );
    }
    // Recreate with the original delete rule, not a guessed one — losing a
    // CASCADE here would leave orphans on every account deletion.
    for (const f of userFks) {
      await client.query(
        `ALTER TABLE "${f.child}" ADD CONSTRAINT "${f.name}"
           FOREIGN KEY ("${f.col}") REFERENCES "User"("id") ON DELETE ${f.on_delete}`
      );
    }

    // ── Verify ──────────────────────────────────────────────────────────────
    const types = await client.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema='public'
          AND ((table_name='User' AND column_name='id')
            OR (table_name='ListeningHistory' AND column_name IN ('id','userId')))
        ORDER BY table_name, column_name`
    );
    console.log(`\n  Resulting types:`);
    for (const t of types.rows) {
      console.log(`    ${`${t.table_name}.${t.column_name}`.padEnd(30)} ${t.data_type}`);
    }

    const fkCount = (
      await client.query(`
      SELECT COUNT(*)::int n FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='User' AND ccu.column_name='id'`)
    ).rows[0].n;
    console.log(`  Foreign keys restored: ${fkCount}/${userFks.length} ${fkCount === userFks.length ? "✓" : "✖"}`);
    if (fkCount !== userFks.length) throw new Error("FK restoration incomplete");

    // Data must still be readable and joinable.
    const probe = await client.query(
      `SELECT u.username, COUNT(h.*)::int plays
         FROM "User" u LEFT JOIN "ListeningHistory" h ON h."userId" = u.id
        GROUP BY u.username ORDER BY plays DESC`
    );
    console.log(`  Join probe:`);
    for (const r of probe.rows) console.log(`    ${r.username}: ${r.plays} plays`);

    const sizeAfter = Number(
      (await client.query(`SELECT pg_database_size(current_database()) b`)).rows[0].b
    );
    console.log(
      `\n  Database: ${(sizeBefore / 1048576).toFixed(2)} MB → ${(sizeAfter / 1048576).toFixed(2)} MB`
    );
    console.log(`  (space is reclaimed lazily; the win is ~121 B per future history row)`);

    if (APPLY) {
      await client.query("COMMIT");
      console.log(`\n  COMMITTED ✓`);
      console.log(`  Next: update prisma/schema.prisma and regenerate the client.\n`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n  DRY RUN — rolled back. Re-run with --apply.\n`);
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`\n  FAILED, rolled back: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
