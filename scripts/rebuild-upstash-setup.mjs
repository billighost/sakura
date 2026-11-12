import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";

// Uses the official CLI's saved login/API client. Credentials never enter argv,
// stdout, versioned files, or the browser. Creation requires the explicit flag.
const root = fileURLToPath(new URL("..", import.meta.url));
const argument = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const name = argument("--name") || "sakura-cache";
const region = argument("--region");
if (!region || !/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^[a-zA-Z0-9_-]{1,60}$/.test(name)) {
  throw new Error("Specify --region and a simple --name; add --create to provision a free database.");
}
const cliDirectory = argument("--cli-dir") || (process.platform === "win32" && process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm/node_modules/upstash/dist") : undefined);
if (!cliDirectory) throw new Error("Supply --cli-dir pointing to the installed official Upstash CLI dist directory.");
await access(path.join(cliDirectory, "auth.js"));
const { resolveAuth } = await import(pathToFileURL(path.join(cliDirectory, "auth.js")).href);
const { request } = await import(pathToFileURL(path.join(cliDirectory, "client.js")).href);
dotenv.config({ path: [path.join(root, ".env.local"), path.join(root, ".env")], quiet: true });

try {
  const auth = resolveAuth({});
  const databases = await request(auth, "GET", "/v2/redis/databases");
  if (!Array.isArray(databases)) throw new Error("Unexpected database inventory");
  let database = databases.find(item => item.database_name === name && item.primary_region === region);
  let created = false;
  if (!database) {
    if (!process.argv.includes("--create")) throw new Error("No matching database. Add --create to provision the free cache.");
    database = await request(auth, "POST", "/v2/redis/database", {
      database_name: name, platform: "aws", primary_region: region, plan: "free", tls: true, eviction: true,
    });
    created = true;
  }
  if (database.database_id) database = await request(auth, "GET", `/v2/redis/database/${encodeURIComponent(database.database_id)}`);
  const plan = database.type || database.database_type;
  if (String(plan).toLowerCase() !== "free") throw new Error("A free database is required; no paid plan is enabled by this script.");
  const endpoint = String(database.endpoint || "");
  const hostname = endpoint.includes(".") ? endpoint : endpoint + ".upstash.io";
  const url = new URL("https://" + hostname);
  if (!/\.upstash\.io$/.test(url.hostname) || url.pathname !== "/" || url.port || url.username || url.password) throw new Error("Unexpected REST endpoint");
  if (typeof database.rest_token !== "string" || !/^[a-zA-Z0-9+/=_-]{16,}$/.test(database.rest_token)) throw new Error("Database write credentials unavailable");
  const restUrl = url.origin;
  const redis = new Redis({ url: restUrl, token: database.rest_token, retry: { retries: 0 }, signal: AbortSignal.timeout(15000) });
  const started = Date.now();
  if (await redis.ping() !== "PONG") throw new Error("Cache connection did not pass PING");
  const pingMs = Date.now() - started;

  const filename = path.join(root, ".env.local");
  let contents = await readFile(filename, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
  for (const [key, value] of Object.entries({
    UPSTASH_REDIS_REST_URL: restUrl, UPSTASH_REDIS_REST_TOKEN: database.rest_token,
    SAKURA_REDIS_NAMESPACE: "sakura:public:v1", SAKURA_REDIS_TIMEOUT_MS: "75",
  })) {
    const line = key + "=" + JSON.stringify(value);
    const match = new RegExp("^(?:export\\s+)?" + key + "=.*$", "m");
    contents = match.test(contents) ? contents.replace(match, () => line) : contents.replace(/\s*$/, "") + "\n" + line + "\n";
  }
  await writeFile(filename, contents, { mode: 0o600 });
  const report = {
    databaseId: database.database_id, databaseName: name, region, plan,
    appOrigin: "https://sakuraplayer.vercel.app", observedFunctionRegion: "fra1",
    environmentFile: ".env.local", credentialVariables: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    created, connected: true, pingMs, verifiedAt: new Date().toISOString(),
    deploymentEnvironmentConfigured: false,
  };
  await writeFile(path.join(root, "docs/rebuild/UPSTASH-SETUP.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Upstream error bodies can carry resource/auth details; report only a status.
  console.error(JSON.stringify({ configured: false, error: error.status ? `Upstash HTTP ${error.status}` : error.message }));
  process.exitCode = 1;
}
