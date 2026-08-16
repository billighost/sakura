import { warnOnStrayTelegramSession } from "../deployEnv";
import { MissingWorkerError, WorkerTelegramClient, readConfig } from "./worker";
import type { MusicResult, TelegramMusicClient } from "./types";

/**
 * The app's Telegram entry point.
 *
 * This used to be a 1,300-line file that spoke MTProto directly from Vercel
 * functions. That design cost the project ten-plus `AUTH_KEY_DUPLICATED`
 * revocations, because Telegram permanently kills an auth key the moment it sees
 * it on two connections from two IPs — and a serverless fleet is, by definition,
 * many processes on many IPs. Locks could not fix it: a lock can serialise
 * `connect()`, but the socket outlives the lock, and the last version even kept
 * the session in Redis where a local dev server picked up production's key.
 *
 * So the session moved out. One long-lived worker owns it (`worker/`), and this
 * file is an HTTP client. The invariant is now enforced by there being exactly
 * one process that *can* hold an auth key, which is the only way to enforce it.
 *
 * The public surface is unchanged, so all six call sites work untouched.
 */

export type { MusicResult, TelegramMusicClient };
export { MissingWorkerError };

const globalForTelegram = globalThis as unknown as {
  telegramWorkerClient?: WorkerTelegramClient;
};

/**
 * There is no in-process fallback, on purpose.
 *
 * The obvious convenience — "fall back to direct MTProto when the worker isn't
 * configured, so local dev works" — is the bug. Any code path in the Next.js app
 * capable of opening an MTProto connection re-creates the failure mode the worker
 * exists to remove, and it would fire exactly when someone is least expecting it
 * (a forgotten `.env`, a rolled-back deploy, a preview build). Throwing is the
 * feature: point local dev at the deployed worker, or run the worker locally.
 *
 * Dropping it also takes `telegram` and `big-integer` out of the Vercel bundle.
 */
export function getTelegramClient(): TelegramMusicClient {
  warnOnStrayTelegramSession();

  if (!globalForTelegram.telegramWorkerClient) {
    const cfg = readConfig();
    if (!cfg) throw new MissingWorkerError();
    globalForTelegram.telegramWorkerClient = new WorkerTelegramClient(cfg);
  }

  return globalForTelegram.telegramWorkerClient;
}

/** True when the worker is reachable — for health endpoints and diagnostics. */
export async function telegramWorkerHealth(): Promise<{
  ok: boolean;
  [k: string]: unknown;
}> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "TELEGRAM_WORKER_URL is not set" };
  return new WorkerTelegramClient(cfg).health();
}

/**
 * Bots to try in order when one is rate-limited or has no result.
 *
 * Unchanged behaviour: primary first, then `TELEGRAM_FALLBACK_BOTS` minus any
 * duplicate of the primary. This stays on the Next.js side because it is routing
 * policy, not session state — the worker takes whichever bot it is told to use.
 */
export function getBotFallbackChain(): string[] {
  const primary = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
  const fallbacks = (process.env.TELEGRAM_FALLBACK_BOTS || "")
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b && b !== primary);
  return [primary, ...fallbacks];
}
