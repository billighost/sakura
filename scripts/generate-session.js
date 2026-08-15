const path = require("path");
const fs = require("fs");
const readline = require("readline");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question) =>
  new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));

const rawApiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;
const apiId = rawApiId ? parseInt(rawApiId, 10) : NaN;

if (!apiId || isNaN(apiId) || !apiHash) {
  console.error("❌ ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in your .env file.");
  console.error("   Please obtain them from https://my.telegram.org and add them to .env");
  process.exit(1);
}

(async () => {
  let client;
  try {
    console.log("======================================================");
    console.log("🚀 Telegram Session Generator for Sakura");
    console.log("======================================================\n");
    console.log(`Using API ID: ${apiId}`);
    console.log("Connecting to Telegram MTProto servers...\n");

    const session = new StringSession("");
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await client.start({
      phoneNumber: async () =>
        await ask("📱 Enter your phone number (e.g. +1234567890): "),
      password: async () =>
        await ask("🔒 Enter your 2FA password (if enabled, or press enter): "),
      phoneCode: async () =>
        await ask("🔑 Enter the verification code received on Telegram: "),
      onError: (err) => {
        console.error("⚠️ Authentication issue:", err.message || err);
      },
    });

    const sessionString = client.session.save();

    console.log("\n======================================================");
    console.log("🎉 SUCCESS: You are connected!");
    console.log("======================================================\n");
    console.log("Your TELEGRAM_SESSION_STRING:\n");
    console.log(sessionString);
    console.log("\n======================================================");

    // Auto-seed to Upstash Redis if configured in .env
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (redisUrl && redisToken) {
      try {
        console.log("\n📡 Upstash Redis detected. Seeding session automatically...");
        const seedUrl = `${redisUrl}/set/${encodeURIComponent("telegram:session:latest")}/${encodeURIComponent(sessionString)}`;
        const res = await fetch(seedUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${redisToken}` },
        });
        if (res.ok) {
          console.log("✅ Successfully seeded session string into Upstash Redis (telegram:session:latest)!");
        } else {
          console.warn("⚠️ Could not auto-seed to Redis:", await res.text());
        }
      } catch (redisErr) {
        console.warn("⚠️ Redis auto-seed error:", redisErr.message);
      }
    }

    // Offer to update local .env file
    const envPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, "utf-8");
      if (envContent.includes("TELEGRAM_SESSION_STRING=")) {
        envContent = envContent.replace(
          /TELEGRAM_SESSION_STRING=.*/g,
          `TELEGRAM_SESSION_STRING="${sessionString}"`
        );
      } else {
        envContent += `\nTELEGRAM_SESSION_STRING="${sessionString}"\n`;
      }
      fs.writeFileSync(envPath, envContent, "utf-8");
      console.log("💾 Updated TELEGRAM_SESSION_STRING in your local .env file.");
    }

    console.log("\nNext Steps:");
    console.log("1. If deploying to Vercel, copy the session string above and set TELEGRAM_SESSION_STRING in Vercel settings (or ensure Upstash Redis credentials are set).");
    console.log("2. Restart your dev server / trigger a redeploy.\n");

    await client.disconnect();
    rl.close();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Failed to generate Telegram session:", err.message || err);
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
    rl.close();
    process.exit(1);
  }
})();
