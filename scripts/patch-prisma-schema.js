/**
 * Bring prisma/schema.prisma in line with the id-shrink migration.
 *
 * Three changes, each narrowly targeted:
 *   1. `User.id` and every `userId` field → `@db.Uuid`, so the generated client
 *      binds them as uuid rather than text. Without this the client sends text
 *      parameters against uuid columns and Postgres rejects the comparison.
 *   2. `ListeningHistory.id` → `BigInt @id @default(autoincrement())`, matching
 *      the identity column the migration creates.
 *   3. Add the `PlayAggregate` model, which was created in raw SQL and is
 *      therefore invisible to Prisma — a later `prisma db push` would happily
 *      drop a table it does not know about.
 *
 * Only `userId`/`User.id` are touched. Other id columns (notably `Track.id`,
 * which holds values like `deezer-3937670811`) stay text on purpose.
 *
 * Writes schema.prisma.new next to the original unless --apply is passed, so
 * the diff can be read before anything is overwritten.
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const FILE = path.resolve(__dirname, "..", "prisma", "schema.prisma");

let src = fs.readFileSync(FILE, "utf8");
const before = src;
const changes = [];

// ── 1. userId fields → @db.Uuid ────────────────────────────────────────────
// `[ \t]` rather than `\s`, and `[^\n]*` for the tail: `\s` matches newlines,
// so an earlier version ran past the end of the line and stamped @db.Uuid onto
// whatever field came next (`name String`, `genre String`, a trailing comment…).
// Everything here must stay on one line.
src = src.replace(
  /^([ \t]*userId[ \t]+String\??)([ \t]*)([^\n]*)$/gm,
  (line, decl, ws, rest) => {
    if (/@db\.Uuid/.test(rest)) return line;
    changes.push(`userId → @db.Uuid  (${rest.trim() || "no attrs"})`);
    // A field with no attributes has an empty tail, so the separating space has
    // to come from here — otherwise the result is `String@db.Uuid`.
    const commentAt = rest.indexOf("//");
    if (commentAt >= 0) {
      const attrs = rest.slice(0, commentAt).trimEnd();
      const comment = rest.slice(commentAt);
      return `${decl}${ws}${attrs} @db.Uuid ${comment}`.replace(/ {2,}@db/, " @db");
    }
    const attrs = rest.trimEnd();
    return attrs ? `${decl}${ws}${attrs} @db.Uuid` : `${decl} @db.Uuid`;
  }
);

// ── 2. User.id → @db.Uuid ──────────────────────────────────────────────────
src = src.replace(
  /(model User \{[\s\S]*?)^(\s*id\s+String\s+)(@id @default\(uuid\(\)\))(?!.*@db\.Uuid)/m,
  (m, head, decl, attrs) => {
    changes.push("User.id → @db.Uuid");
    return `${head}${decl}${attrs} @db.Uuid`;
  }
);

// ── 3. ListeningHistory.id → BigInt identity ───────────────────────────────
src = src.replace(
  /(model ListeningHistory \{[\s\S]*?)^(\s*)id(\s+)String(\s+)@id @default\(uuid\(\)\)/m,
  (m, head, ind, w1, w2) => {
    changes.push("ListeningHistory.id → BigInt autoincrement");
    return `${head}${ind}id${w1}BigInt${w2}@id @default(autoincrement())`;
  }
);

// ── 4. PlayAggregate model ─────────────────────────────────────────────────
if (!/model PlayAggregate\b/.test(src)) {
  changes.push("added model PlayAggregate");
  src += `
/// Rolled-up listening history. One row per (user, track) replaces every
/// individual play older than HISTORY_RAW_DAYS, which is what keeps
/// ListeningHistory — the only table that grows with time rather than with
/// catalogue or userbase — bounded on a 500MB tier.
///
/// signalSum is the exact sum of signalWeight() over the folded rows, computed
/// while they still existed. It is stored rather than re-derived because
/// signalWeight is continuous in the played/duration ratio: reconstructing it
/// from counts and averages measured 90% high and reordered users' top artists.
model PlayAggregate {
  userId        String   @db.Uuid
  trackId       String
  plays         Int      @default(0)
  completions   Int      @default(0)
  skips         Int      @default(0)
  totalMsPlayed BigInt   @default(0)
  signalSum     Float    @default(0)
  firstPlayedAt DateTime
  lastPlayedAt  DateTime

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  track Track @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@id([userId, trackId])
  @@index([userId])
}
`;
  // Both sides of the relation must be declared or `prisma generate` errors.
  src = src.replace(
    /(model User \{[\s\S]*?)(\n\s*shares\s+Share\[\])/m,
    (m, head, tail) => `${head}${tail}\n  playAggregates   PlayAggregate[]`
  );
  src = src.replace(
    /(model Track \{[\s\S]*?)(\n\})/m,
    (m, head, tail) => `${head}\n  playAggregates PlayAggregate[]${tail}`
  );
}

console.log(`\n  ${changes.length} change(s):`);
for (const c of changes) console.log(`    • ${c}`);

if (src === before) {
  console.log(`\n  Nothing to do — schema already matches.\n`);
  process.exit(0);
}

const out = APPLY ? FILE : FILE + ".new";
fs.writeFileSync(out, src);
console.log(`\n  Written to ${path.basename(out)}`);
if (!APPLY) console.log(`  Review it, then re-run with --apply.\n`);
else console.log(`  Next: npx prisma generate\n`);
