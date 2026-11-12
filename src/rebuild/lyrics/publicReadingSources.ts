import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PROOF_LIFETIME_MS = 60 * 60_000;
const PROVIDERS = new Set(["lrclib", "netease", "lyrica", "lyrics.ovh"]);
interface PublicSource { provider: string; providerTrackId: number }

/** Exact complete ordered text, including blank lines; never normalize a draft. */
export function publicReadingTextDigest(texts: readonly string[]) {
  if (!texts.length || texts.length > 400 || texts.some(text => typeof text !== "string")
    || texts.reduce((total, text) => total + text.length, 0) > 20_000 || !texts.some(text => text.trim())) return undefined;
  return createHash("sha256").update("sakura-public-reading-text-v1:").update(JSON.stringify(texts)).digest("hex");
}

/** Hash-only local eligibility plus a short public-source proof for separate
 * serverless functions. Neither account data nor source text enters the proof. */
export class PublicReadingSources {
  private hashes = new Map<string, number>();
  private now: () => number;
  private maximumEntries: number;
  private signingKey?: Buffer;

  constructor(options: { secret?: string; now?: () => number; maxEntries?: number } = {}) {
    this.now = options.now || Date.now;
    this.maximumEntries = Math.min(512, Math.max(0, options.maxEntries ?? 256));
    if (options.secret && options.secret.length >= 32) this.signingKey = createHmac("sha256", options.secret).update("sakura-public-reading-proof-key-v1").digest();
  }

  register(texts: readonly string[], source: PublicSource) {
    const digest = publicReadingTextDigest(texts);
    if (!digest || !PROVIDERS.has(source.provider) || !Number.isSafeInteger(source.providerTrackId) || source.providerTrackId < 0) return undefined;
    const issuedAt = this.now(), expiresAt = issuedAt + PROOF_LIFETIME_MS;
    if (this.maximumEntries > 0) {
      this.hashes.delete(digest); this.hashes.set(digest, expiresAt);
      while (this.hashes.size > this.maximumEntries) this.hashes.delete(this.hashes.keys().next().value!);
    }
    if (!this.signingKey) return undefined;
    const body = Buffer.from(JSON.stringify({ v: 1, digest, provider: source.provider, sourceId: source.providerTrackId, issuedAt, expiresAt })).toString("base64url");
    return body + "." + createHmac("sha256", this.signingKey).update("sakura-public-reading-proof-v1:").update(body).digest("base64url");
  }

  isPublic(texts: readonly string[], proof?: unknown) {
    const digest = publicReadingTextDigest(texts);
    if (!digest) return false;
    const now = this.now(), expires = this.hashes.get(digest);
    if (expires && expires > now) { this.hashes.delete(digest); this.hashes.set(digest, expires); return true; }
    if (expires) this.hashes.delete(digest);
    if (!this.signingKey || typeof proof !== "string" || proof.length > 1024) return false;
    const [body, signature, extra] = proof.split(".");
    if (extra || !/^[a-zA-Z0-9_-]+$/.test(body || "") || !/^[a-zA-Z0-9_-]{43}$/.test(signature || "")) return false;
    try {
      const expected = createHmac("sha256", this.signingKey).update("sakura-public-reading-proof-v1:").update(body).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
      const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      return value && value.v === 1 && value.digest === digest && PROVIDERS.has(value.provider)
        && Number.isSafeInteger(value.sourceId) && value.sourceId >= 0
        && Number.isSafeInteger(value.issuedAt) && value.issuedAt <= now + 30_000
        && Number.isSafeInteger(value.expiresAt) && value.expiresAt === value.issuedAt + PROOF_LIFETIME_MS
        && value.expiresAt > now && value.expiresAt <= now + PROOF_LIFETIME_MS + 30_000;
    } catch { return false; }
  }
}

const publicSources = new PublicReadingSources({ secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET });
export const registerPublicReadingSource = (texts: readonly string[], source: PublicSource) => publicSources.register(texts, source);
export const verifiedPublicReadingSource = (texts: readonly string[], proof?: unknown) => publicSources.isPublic(texts, proof);
