import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

/** Only public, descriptive data may enter this cache. Account state, password
 * checks, provider tokens, signed playback targets and media stay elsewhere. */
export type SharedPublicCacheScope = "provider_deezer" | "provider_spotify" | "reading_transform";
const scopes = new Set<string>(["provider_deezer", "provider_spotify", "reading_transform"]);
const privateFields = new Set([
  "accountid", "userid", "email", "password", "passwordhash", "token", "accesstoken", "refreshtoken",
  "authorization", "cookie", "setcookie", "secret", "clientsecret", "playback", "playbackurl", "audiourl",
  "sourceurl", "signedurl", "fallbackurl", "preview", "previewurl", "audiolocator", "telegramlocator",
]);
const signedAddress = /[?&](?:token|signature|sig|secret|authorization|x-amz-signature)=/i;
const maximumTtl = 24 * 60 * 60;
const maximumBytes = 256 * 1024;
const fieldName = (key: string) => key.toLowerCase().replace(/[_-]/g, "");

/** Provider JSON includes unused preview addresses and pagination search text.
 * Keep the descriptive projection and paging availability without storing those
 * addresses. Providers still validate a shared hit through their usual parser. */
export function publicCatalogMetadata(value: unknown): unknown {
  let nodes = 0;
  const project = (input: unknown, depth: number): unknown => {
    if (++nodes > 20_000 || depth > 32) throw new Error("Public metadata is too complex");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
    if (typeof input === "string") return signedAddress.test(input) ? undefined : input;
    if (Array.isArray(input)) return input.map(item => project(item, depth + 1) ?? null);
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (privateFields.has(fieldName(key))) continue;
      // Search pagination URLs embed a caller's raw query. Consumers of the
      // public metadata service need availability, not this upstream address.
      if (["next", "previous", "href"].includes(key) && typeof child === "string" && /[?&]q=/.test(child)) {
        if (key !== "href") result[key] = "available";
        continue;
      }
      const projected = project(child, depth + 1);
      if (projected !== undefined) Object.defineProperty(result, key, { value: projected, enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  try { return project(value, 0); } catch { return undefined; }
}

function publicValue(value: unknown): boolean {
  let nodes = 0;
  const safe = (input: unknown, depth: number): boolean => {
    if (++nodes > 20_000 || depth > 32) return false;
    if (input === null || typeof input === "boolean") return true;
    if (typeof input === "number") return Number.isFinite(input);
    if (typeof input === "string") return !signedAddress.test(input);
    if (Array.isArray(input)) return input.every(item => safe(item, depth + 1));
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) return false;
    return Object.entries(input).every(([key, child]) => !privateFields.has(fieldName(key)) && safe(child, depth + 1));
  };
  return safe(value, 0);
}

export interface PublicRedisTransport {
  get(key: string, signal: AbortSignal): Promise<unknown>;
  set(key: string, value: string, ttlSeconds: number, signal: AbortSignal): Promise<unknown>;
}

interface CacheOptions {
  transport?: PublicRedisTransport;
  namespace?: string;
  timeoutMs?: number;
  cooldownMs?: number;
  now?: () => number;
}

/** Redis is a best-effort L2. A full/slow/down cache returns a miss promptly;
 * it never queues behind metadata reads or retries ahead of playback. */
export class SharedPublicMetadataCache {
  private readonly transport?: PublicRedisTransport;
  private readonly namespace: string;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private unavailableUntil = 0;
  private active = 0;

  constructor(options: CacheOptions = {}) {
    this.transport = options.transport;
    this.namespace = /^[a-zA-Z0-9:_-]{1,80}$/.test(options.namespace || "") ? options.namespace! : "sakura:public:v1";
    this.timeoutMs = Math.min(250, Math.max(10, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 75));
    this.cooldownMs = Math.min(300_000, Math.max(1_000, Number.isFinite(options.cooldownMs) ? options.cooldownMs! : 30_000));
    this.now = options.now || Date.now;
  }

  private key(scope: SharedPublicCacheScope, key: string): string | undefined {
    if (!scopes.has(scope) || !key || key.length > 8_192) return undefined;
    return `${this.namespace}:${scope}:${createHash("sha256").update(key).digest("hex")}`;
  }

  private async command<T>(operation: (transport: PublicRedisTransport, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (!this.transport || this.now() < this.unavailableUntil || this.active >= 4) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.active++;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Public cache deadline exceeded"));
        }, this.timeoutMs);
      });
      return await Promise.race([Promise.resolve().then(() => operation(this.transport!, controller.signal)), timeout]);
    } catch {
      this.unavailableUntil = this.now() + this.cooldownMs;
      return undefined;
    } finally {
      clearTimeout(timer);
      this.active--;
    }
  }

  async get<T>(scope: SharedPublicCacheScope, key: string): Promise<T | undefined> {
    if (!this.transport || this.now() < this.unavailableUntil || this.active >= 4) return undefined;
    const name = this.key(scope, key);
    if (!name) return undefined;
    const raw = await this.command((transport, signal) => transport.get(name, signal));
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > maximumBytes + 128) return undefined;
    try {
      const saved = JSON.parse(raw) as { version?: unknown; expiresAt?: unknown; value?: unknown };
      const now = this.now();
      if (!saved || saved.version !== 1 || typeof saved.expiresAt !== "number" || !Number.isFinite(saved.expiresAt)
        || saved.expiresAt <= now || saved.expiresAt > now + maximumTtl * 1000 + 60_000 || !publicValue(saved.value)) return undefined;
      return saved.value as T;
    } catch { return undefined; }
  }

  async set(scope: SharedPublicCacheScope, key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.transport || this.now() < this.unavailableUntil || this.active >= 4) return;
    const name = this.key(scope, key);
    if (!name || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > maximumTtl) return;
    try {
      if (!publicValue(value)) return;
      const raw = JSON.stringify({ version: 1, expiresAt: this.now() + ttlSeconds * 1000, value });
      if (Buffer.byteLength(raw, "utf8") > maximumBytes) return;
      await this.command((transport, signal) => transport.set(name, raw, ttlSeconds, signal));
    } catch { /* Invalid/cyclic/oversized metadata is simply not cached. */ }
  }
}

function configuredTransport(): PublicRedisTransport | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return undefined;
  try {
    const address = new URL(url);
    if (address.protocol !== "https:" || address.username || address.password || address.search || address.hash
      || address.pathname !== "/" || (address.port !== "" && address.port !== "443")
      || !/\.(?:upstash\.io|upstash\.com)$/.test(address.hostname)) return undefined;
  } catch { return undefined; }
  const client = (signal: AbortSignal) => new Redis({
    url, token, signal, retry: { retries: 0 }, automaticDeserialization: false, enableAutoPipelining: false,
  });
  return {
    get: (key, signal) => client(signal).get<string>(key),
    set: (key, value, ttlSeconds, signal) => client(signal).set(key, value, { ex: ttlSeconds }),
  };
}

const runtime = globalThis as typeof globalThis & { sakuraSharedPublicRedis?: SharedPublicMetadataCache };
function sharedCache(): SharedPublicMetadataCache {
  if (!runtime.sakuraSharedPublicRedis) {
    const configuredTimeout = Number(process.env.SAKURA_REDIS_TIMEOUT_MS);
    runtime.sakuraSharedPublicRedis = new SharedPublicMetadataCache({
      transport: configuredTransport(),
      namespace: process.env.SAKURA_REDIS_NAMESPACE,
      timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : undefined,
    });
  }
  return runtime.sakuraSharedPublicRedis;
}

export function getSharedPublicCache<T>(scope: SharedPublicCacheScope, key: string): Promise<T | undefined> {
  return sharedCache().get<T>(scope, key);
}

export function setSharedPublicCache(scope: SharedPublicCacheScope, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  return sharedCache().set(scope, key, value, ttlSeconds);
}
