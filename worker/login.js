"use strict";

/**
 * Generate a TELEGRAM_SESSION_STRING by logging in interactively.
 *
 * Run this on your own machine (`npm run login`), then paste the result into the
 * worker's environment — and *only* the worker's. The whole point of the worker
 * architecture is that exactly one process ever holds this key; putting the same
 * string in a second place is what revokes it.
 *
 * A generated session is a long-lived credential equivalent to being logged into
 * the account. It is printed once, here, and never logged again anywhere else in
 * this codebase.
 */

require("dotenv").config();

const input = require("input");
const { TelegramClient: GramClient, sessions } = require("telegram");

const { StringSession } = sessions;

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!apiId || !apiHash) {
    console.error(
      "Set TELEGRAM_API_ID and TELEGRAM_API_HASH first (worker/.env or your shell).\n" +
        "Get them from https://my.telegram.org → API development tools.",
    );
    process.exit(1);
  }

  console.log("\nLogging in to Telegram to mint a new session string.\n");

  const client = new GramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => input.text("Phone number (with country code, e.g. +2348012345678): "),
    password: () => input.password("Two-step verification password (blank if none): "),
    phoneCode: () => input.text("Login code Telegram just sent you: "),
    onError: (err) => console.error("Login error:", err?.message || err),
  });

  const session = client.session.save();
  const me = await client.getMe();

  console.log("\n" + "─".repeat(72));
  console.log(`Logged in as ${me?.username ? "@" + me.username : me?.id}`);
  console.log("─".repeat(72));
  console.log("\nTELEGRAM_SESSION_STRING=" + session + "\n");
  console.log("─".repeat(72));
  console.log(
    "\nNext steps — the order matters:\n" +
      "\n  1. Set this on the WORKER only:\n" +
      "       fly secrets set TELEGRAM_SESSION_STRING='<the string above>'\n" +
      "\n  2. REMOVE TELEGRAM_SESSION_STRING from Vercel entirely (all three\n" +
      "     environments). Vercel no longer talks to Telegram directly, and a\n" +
      "     leftover copy there is the most likely cause of the next\n" +
      "     AUTH_KEY_DUPLICATED.\n" +
      "\n  3. Do NOT put it in your local .env. For local development, point\n" +
      "     TELEGRAM_WORKER_URL at the deployed worker instead — one session,\n" +
      "     one process, no matter where you run the app from.\n" +
      "\n  4. Delete the worker's cached session file if one exists, so the new\n" +
      "     key is used from a clean slate:\n" +
      "       fly ssh console -C 'rm -f /data/session.json'   (or just redeploy)\n",
  );

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err?.message || err);
  process.exit(1);
});
