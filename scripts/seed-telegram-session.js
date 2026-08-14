/**
 * seed-telegram-session.js
 *
 * Seeds the Telegram session string into Upstash Redis so that every Vercel
 * serverless container reads the same up-to-date MTProto session state instead
 * of the potentially stale value stored in the TELEGRAM_SESSION_STRING env var.
 *
 * Why this matters:
 *   MTProto (Telegram's protocol) tracks per-session sequence numbers and
 *   encryption salts. When a serverless container connects, these values
 *   advance. The NEXT container must use the UPDATED values — if it reads the
 *   original env-var string (which has old sequence numbers), Telegram sees it
 *   as a replay attack and revokes the key with AUTH_KEY_DUPLICATED.
 *
 *   By seeding the session into Redis once (right after generation), and having
 *   the app always read from / write back to Redis, the session stays fresh
 *   across all container restarts indefinitely.
 *
 * Usage:
 *   node scripts/seed-telegram-session.js
 *
 * Prerequisites:
 *   - .env file must contain UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 *   - The session string must be set as SESSION_STRING below (or passed via env)
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// ── Configuration ────────────────────────────────────────────────────────────
// You can either hardcode the session string here (for a one-off seed) or pass
// it as an env var: SESSION_STRING="1BAA..." node scripts/seed-telegram-session.js
const SESSION_STRING =
  process.env.SESSION_STRING || process.env.TELEGRAM_SESSION_STRING || "";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// The same Redis key the app reads/writes at runtime. Must stay in sync with
// the key used in RedisMutex.saveSession() / RedisMutex.loadSession()
const REDIS_SESSION_KEY = "telegram:session:latest";

// ── Validation ───────────────────────────────────────────────────────────────
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error(
    "❌ Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.\n" +
    "   Make sure your .env file is configured correctly."
  );
  process.exit(1);
}

if (!SESSION_STRING) {
  console.error(
    "❌ No session string provided.\n" +
    "   Either set SESSION_STRING env var or TELEGRAM_SESSION_STRING in .env"
  );
  process.exit(1);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seedSession() {
  console.log("🔑 Seeding Telegram session string into Upstash Redis...");
  console.log(`   Redis URL : ${REDIS_URL}`);
  console.log(`   Key       : ${REDIS_SESSION_KEY}`);
  console.log(`   Session   : ${SESSION_STRING.slice(0, 20)}...`);

  // Upstash REST API: SET key value
  // No TTL — the session must persist indefinitely and be updated in place.
  const url = `${REDIS_URL}/set/${encodeURIComponent(REDIS_SESSION_KEY)}/${encodeURIComponent(SESSION_STRING)}`;

  const res = await fetch(url, {
    method: "GET", // Upstash REST uses GET for simple SET commands in this format
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Redis SET failed (HTTP ${res.status}): ${body}`);
    process.exit(1);
  }

  const json = await res.json();
  if (json.result !== "OK") {
    console.error("❌ Unexpected Redis response:", json);
    process.exit(1);
  }

  console.log("✅ Session string successfully seeded into Redis!");
  console.log("   The app will now use this session on every Vercel cold start.");
  console.log("   You do NOT need to update TELEGRAM_SESSION_STRING in Vercel env vars.");
  console.log("   Just make sure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set there.");
}

seedSession().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
