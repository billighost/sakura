/**
 * Which SQL shapes break when a text parameter meets a uuid column?
 *
 * After User.id became native uuid, the driver still sends JS strings as text.
 * Postgres infers parameter types from context, and that context differs by
 * statement shape — so rather than guessing which of 16 files need a cast, this
 * probes each shape against a scratch table and reports what actually fails.
 *
 * Read-only with respect to real data: everything happens inside a rolled-back
 * transaction on a temporary table.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
const { Pool } = require("pg");

const ID = "11111111-2222-3333-4444-555555555555";

const SHAPES = [
  ["INSERT … VALUES ($1)", `INSERT INTO probe (uid) VALUES ($1)`, [ID]],
  ["INSERT … SELECT $1", `INSERT INTO probe (uid) SELECT $1`, [ID]],
  ["INSERT … SELECT $1 FROM UNNEST", `INSERT INTO probe (uid) SELECT $1 FROM UNNEST($2::text[]) x`, [ID, ["a"]]],
  ["INSERT … SELECT FROM UNNEST($1::text[])", `INSERT INTO probe (uid) SELECT x FROM UNNEST($1::text[]) x`, [[ID]]],
  ["WHERE uid = $1", `SELECT 1 FROM probe WHERE uid = $1`, [ID]],
  ["WHERE uid = ANY($1::text[])", `SELECT 1 FROM probe WHERE uid = ANY($1::text[])`, [[ID]]],
  ["UPDATE … WHERE uid = $1", `UPDATE probe SET n = 1 WHERE uid = $1`, [ID]],
  ["ON CONFLICT … VALUES ($1)", `INSERT INTO probe (uid) VALUES ($1) ON CONFLICT DO NOTHING`, [ID]],
  ["JOIN on uid = $1", `SELECT 1 FROM probe p JOIN probe q ON q.uid = p.uid WHERE p.uid = $1`, [ID]],
  ["COALESCE($1, uid)", `SELECT COALESCE($1, uid) FROM probe`, [ID]],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const results = [];

  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE probe (uid uuid, n int) ON COMMIT DROP`);
    await client.query(`ALTER TABLE probe ADD CONSTRAINT probe_uid_key UNIQUE (uid)`);

    for (const [label, sql, params] of SHAPES) {
      await client.query("SAVEPOINT s");
      try {
        await client.query(sql, params);
        results.push([label, true, ""]);
      } catch (e) {
        results.push([label, false, e.message.split("\n")[0]]);
      }
      await client.query("ROLLBACK TO SAVEPOINT s");
    }

    // Is an implicit text→uuid cast even available as a global fix?
    const { rows: existing } = await client.query(`
      SELECT castcontext FROM pg_cast
       WHERE castsource = 'text'::regtype AND casttarget = 'uuid'::regtype`);

    console.log(`\n  Shape-by-shape behaviour with a text param against a uuid column:\n`);
    for (const [label, ok, err] of results) {
      console.log(`   ${ok ? "✓" : "✖"} ${label.padEnd(42)}${ok ? "" : err}`);
    }

    const broken = results.filter((r) => !r[1]);
    console.log(`\n  ${broken.length}/${results.length} shapes fail.`);
    console.log(
      `  Registered text→uuid cast: ${existing.length ? existing[0].castcontext : "none (I/O conversion only)"}`
    );

    if (!existing.length) {
      await client.query("SAVEPOINT c");
      try {
        await client.query(`CREATE CAST (text AS uuid) WITH INOUT AS IMPLICIT`);
        let fixed = 0;
        for (const [label, sql, params] of SHAPES) {
          await client.query("SAVEPOINT t");
          try {
            await client.query(sql, params);
            fixed++;
          } catch { /* still broken */ }
          await client.query("ROLLBACK TO SAVEPOINT t");
        }
        console.log(`  With an IMPLICIT cast installed: ${fixed}/${results.length} shapes pass.`);
      } catch (e) {
        console.log(`  Cannot create implicit cast: ${e.message.split("\n")[0]}`);
      }
      await client.query("ROLLBACK TO SAVEPOINT c");
    }
    console.log();
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
