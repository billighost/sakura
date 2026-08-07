const dotenv = require('dotenv');
dotenv.config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const sessionString = process.env.TELEGRAM_SESSION_STRING || "";
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";

  console.log("API ID:", apiId);
  console.log("API Hash:", apiHash ? "Present" : "Missing");
  console.log("Session String Length:", sessionString.length);
  console.log("Connecting with Bot:", botUsername);

  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 5, autoReconnect: true }
  );

  await client.connect();
  console.log("Connected successfully!");

  const botEntity = await client.getEntity(botUsername);
  console.log("Bot Entity retrieved:", botEntity.username || botEntity.id);

  const query = "Taylor Swift - Blank Space";
  console.log("Sending query:", query);
  await client.sendMessage(botEntity, { message: query });

  console.log("Waiting for response...");
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const messages = await client.getMessages(botEntity, { limit: 5 });
    console.log(`\n--- Pass ${i + 1} ---`);
    for (const msg of messages) {
      console.log(`[Message ID ${msg.id}] Sender: ${msg.senderId} | Date: ${msg.date} | Text: ${msg.message ? msg.message.substring(0, 60) : 'none'}`);
      if (msg.replyMarkup) {
        console.log("  Has replyMarkup!");
        if (msg.replyMarkup.rows) {
          for (const row of msg.replyMarkup.rows) {
            for (const btn of row.buttons) {
              console.log(`    Button: text="${btn.text}" data=${btn.data ? btn.data.toString('hex') : 'none'}`);
            }
          }
        }
      }
      if (msg.media) {
        console.log("  Has media:", msg.media.className || typeof msg.media);
        if (msg.media.document) {
          const doc = msg.media.document;
          console.log(`    Document ID: ${doc.id}, mime: ${doc.mimeType}, size: ${doc.size}`);
          for (const attr of doc.attributes) {
            if (attr.className === 'DocumentAttributeAudio') {
              console.log(`      Audio: title="${attr.title}" performer="${attr.performer}" duration=${attr.duration}`);
            }
          }
        }
      }
    }
  }
  await client.disconnect();
}

main().catch(console.error);
