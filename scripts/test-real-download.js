const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

// Scoring logic exactly matching our changes
function scoreButtons(buttons, targetDuration) {
  let selectedIndex = 0;
  let bestScore = -999999;
  const scored = [];

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const text = btn.text.toLowerCase();
    let score = 0;

    const isPreview = text.includes("preview") || text.includes("30s") || text.includes("30 sec") || text.includes("clip");
    if (isPreview) score -= 1000;

    const durationRegex = /(?:\[|\()(\d{1,2}):(\d{2})(?:\]|\))/;
    const match = btn.text.match(durationRegex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const duration = min * 60 + sec;

      if (targetDuration && targetDuration > 0) {
        const diff = Math.abs(duration - targetDuration);
        if (diff <= 5) score += 200;
        else if (diff <= 15) score += 100;
        else if (diff > 45 && targetDuration > 45 && duration < 45) score -= 500;
        else score -= diff;
      } else {
        if (duration < 45) score -= 300;
      }
    }

    if (text.includes("320") || text.includes("flac") || text.includes("kbps")) {
      score += 10;
    }

    scored.push({ index: i, text: btn.text, score });

    if (score > bestScore) {
      bestScore = score;
      selectedIndex = i;
    }
  }

  return { selectedIndex, scored };
}

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const sessionString = process.env.TELEGRAM_SESSION_STRING || "";
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";

  // Force no proxy for this local test — the SOCKS proxy has expired
  // Production (Vercel) still uses the proxy via env vars in the actual server code
  const proxyConfig = undefined;

  console.log("Connecting with Bot:", botUsername, "(no proxy - direct connection)");
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 5, autoReconnect: true }
  );

  await client.connect();
  console.log("Connected successfully!");


  const botEntity = await client.getEntity(botUsername);
  
  // Since the bot is rate-limited for text searches today,
  // use a direct Deezer URL which bypasses the limit
  const query = "https://www.deezer.com/en/track/2210493097"; // YOASOBI - アイドル
  const targetDuration = 232; // 3:52
  console.log(`\nSearching via Deezer URL (bot rate-limit workaround): ${query}`);

  // Search
  // Last message ID before sending
  const before = await client.getMessages(botEntity, { limit: 1 });
  const lastKnownId = before[0]?.id || 0;

  await client.sendMessage(botEntity, { message: query });

  // Poll for the bot's response
  let buttonMessageId = null;
  let buttons = [];
  const deadline = Date.now() + 55000; // 55s — URL downloads can take longer

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const newMessages = await client.getMessages(botEntity, {
      limit: 5,
      minId: lastKnownId,
    });

    for (const msg of newMessages) {
      if (!msg || !msg.id || msg.id <= lastKnownId) continue;
      const replyMarkup = msg.replyMarkup;
      if (replyMarkup instanceof Api.ReplyInlineMarkup) {
        let idx = 0;
        for (const row of replyMarkup.rows) {
          for (const btn of row.buttons) {
            if (btn instanceof Api.KeyboardButtonCallback) {
              buttons.push({
                index: idx,
                text: btn.text || `Option ${idx + 1}`,
                data: btn.data
              });
              idx++;
            }
          }
        }
        if (buttons.length > 0) {
          buttonMessageId = msg.id;
          break;
        }
      }
    }
    if (buttonMessageId) break;
  }

  if (!buttonMessageId) {
    throw new Error("Bot did not respond with buttons");
  }

  console.log(`Found ${buttons.length} buttons.`);
  const { selectedIndex, scored } = scoreButtons(buttons, targetDuration);
  
  console.log("\nScored Options:");
  scored.forEach(s => {
    console.log(`  Index ${s.index}: "${s.text}" -> Score: ${s.score}`);
  });

  const selectedButton = buttons[selectedIndex];
  console.log(`\nSelected Index ${selectedIndex}: "${selectedButton.text}"`);

  // Click the button
  await client.invoke(
    new Api.messages.GetBotCallbackAnswer({
      peer: botEntity,
      msgId: buttonMessageId,
      data: Buffer.from(selectedButton.data),
    })
  );

  console.log("Clicked button. Waiting for audio file response (up to 45s)...");
  let audioMsg = null;
  const selectDeadline = Date.now() + 45000;

  while (Date.now() < selectDeadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const newMessages = await client.getMessages(botEntity, {
      limit: 5,
      minId: buttonMessageId,
    });

    for (const msg of newMessages) {
      if (!msg || !msg.media || !("document" in msg.media)) continue;
      if (msg.id <= buttonMessageId) continue;

      const doc = msg.media.document;
      if (!(doc instanceof Api.Document)) continue;

      const isAudio = doc.mimeType?.startsWith("audio/") ||
        doc.attributes.some((a) => a instanceof Api.DocumentAttributeAudio);

      if (isAudio) {
        audioMsg = msg;
        break;
      }
    }
    if (audioMsg) break;
  }

  if (!audioMsg) {
    throw new Error("Audio not received within timeout");
  }

  console.log("Audio message received! Downloading audio file...");
  const stream = await client.downloadMedia(audioMsg);
  let buffer;

  if (Buffer.isBuffer(stream)) {
    buffer = stream;
  } else {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  }

  const outputPath = path.join(__dirname, "../public/YOASOBI_idol.mp3");
  fs.writeFileSync(outputPath, buffer);
  console.log(`\nSuccess! Saved downloaded track to ${outputPath} (${buffer.length} bytes)`);
  await client.disconnect();
}

main().catch(console.error);
