const { getTelegramClient } = require("../src/lib/telegram");
require("dotenv").config();
(async () => {
  try {
    const client = getTelegramClient();
    await client.init();
    console.log("Connected");
    const track = await client.searchAndSelect("Deepend - Havana (Chill Mix)", undefined, 20000, 35000);
    console.log(track);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
