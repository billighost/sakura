const dotenv = require('dotenv');
dotenv.config();
const { Client } = require('pg');

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  console.log("Connecting...");
  await client.connect();
  console.log("Connected successfully!");

  console.log("Running query...");
  const res = await client.query("SELECT 1 AS ok");
  console.log("Result:", res.rows);

  await client.end();
}

main().catch(console.error);
