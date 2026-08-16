/**
 * Which deployment this process is.
 *
 * Every environment shares one Upstash database and one Postgres, so a cache
 * key without an environment in it is a key three deployments fight over. That
 * is not theoretical: a local dev run negative-caching a failed download blocked
 * the same track in production for the length of the TTL, and a dev process
 * writing a Telegram session into a shared key is what got the auth key revoked
 * repeatedly.
 *
 * Prefixing is cheap. Debugging cross-environment interference is not.
 */

export type DeployEnv = "prod" | "preview" | "dev";

let cached: DeployEnv | null = null;

/**
 * `VERCEL_ENV` is the authority when present — it is set by the platform and
 * distinguishes preview from production, which `NODE_ENV` cannot (a preview
 * build is `NODE_ENV=production` too). That gap is exactly how preview
 * deployments ended up sharing production's Telegram session.
 */
export function deployEnv(): DeployEnv {
  if (cached) return cached;

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") cached = "prod";
  else if (vercelEnv === "preview") cached = "preview";
  else if (vercelEnv === "development") cached = "dev";
  else cached = process.env.NODE_ENV === "production" ? "prod" : "dev";

  return cached;
}

/** `dl:alias:foo` → `prod:dl:alias:foo`. */
export function envKey(key: string): string {
  return `${deployEnv()}:${key}`;
}

let strayWarned = false;

/**
 * Complain — once, loudly — about a Telegram session string in this process's
 * environment.
 *
 * Nothing in the Next.js app reads it any more; MTProto lives only in the
 * worker. But a copy sitting in Vercel or a local `.env` is a loaded gun: roll
 * back to a deployment that predates the worker, or run an old branch locally,
 * and that string opens a second connection with the same auth key. Telegram
 * revokes it on the spot, and the symptom shows up hours later in a completely
 * unrelated request.
 *
 * Deliberately a log rather than a throw. The stray variable is inert while this
 * code is deployed, and taking down the app over an unused env var would be a
 * worse outcome than the thing being warned about.
 */
export function warnOnStrayTelegramSession(): void {
  if (strayWarned) return;
  strayWarned = true;

  if (!process.env.TELEGRAM_SESSION_STRING) return;

  console.error(
    `[telegram] TELEGRAM_SESSION_STRING is set in the ${deployEnv()} environment ` +
      `but nothing here uses it — MTProto now runs only in the worker.\n` +
      `           Remove it. While it exists, any rollback to a pre-worker ` +
      `deployment will open a second connection on the same auth key and ` +
      `Telegram will revoke the session (AUTH_KEY_DUPLICATED).\n` +
      `           vercel env rm TELEGRAM_SESSION_STRING production\n` +
      `           vercel env rm TELEGRAM_SESSION_STRING preview\n` +
      `           vercel env rm TELEGRAM_SESSION_STRING development`,
  );
}
