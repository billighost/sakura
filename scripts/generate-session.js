const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

(async () => {
  console.log('Loading interactive Telegram sign-in...');
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await ask('Please enter your number (e.g., +1234567890): '),
    password: async () => await ask('Please enter your password (if 2FA enabled): '),
    phoneCode: async () => await ask('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });

  console.log('\n======================================================');
  console.log('You are now connected!');
  console.log('Copy the string below and update TELEGRAM_SESSION_STRING in your .env file:');
  console.log('======================================================\n');
  
  console.log(client.session.save());
  
  console.log('\n======================================================\n');
  await client.disconnect();
  rl.close();
})();
