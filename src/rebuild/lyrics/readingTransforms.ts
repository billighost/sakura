import { createHash } from "node:crypto";
import { romanizeLyricLines } from "./readings";
import { readingEngine, READING_VERSION, type ReadingLanguage } from "./language";
import { JAPANESE_READING_VERSION } from "./versions";
import { getSharedPublicCache, setSharedPublicCache } from "../server/redisCache";
import { verifiedPublicReadingSource } from "./publicReadingSources";

interface ReadingFields { romanized: string; readingReviewNeeded: boolean; readingEngine: string }
type Transform = (lines: readonly { text: string }[], language: ReadingLanguage) => Promise<ReadingFields[]>;
interface SharedTransform { version: 1; key: string; language: ReadingLanguage; engine: string; fields: ReadingFields[] }
interface SharedReadingCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: SharedTransform, ttlSeconds: number): Promise<void>;
}
const publicSharedCache: SharedReadingCache = {
  get: key => getSharedPublicCache("reading_transform", key),
  set: (key, value, ttl) => setSharedPublicCache("reading_transform", key, value, ttl),
};
function validFields(value: unknown, count: number, engine: string): value is ReadingFields[] {
  return Array.isArray(value) && value.length === count && value.every(line => line && typeof line === "object"
    && typeof line.romanized === "string" && typeof line.readingReviewNeeded === "boolean" && line.readingEngine === engine)
    && value.reduce((bytes, line) => bytes + line.romanized.length * 2, 0) <= 128 * 1024;
}

/** Store pronunciation only. Every caller keeps its own text, timestamps and words. */
export function createReadingTransformCache(options: {
  transform?: Transform; maxEntries?: number; maxBytes?: number;
  shared?: SharedReadingCache; publicSource?: (texts: readonly string[], proof?: unknown) => boolean;
} = {}) {
  const transform = options.transform || romanizeLyricLines;
  // Injected transformations never contact production Redis unless an isolated
  // transport was explicitly supplied by the caller/test.
  const shared = options.shared || (options.transform ? undefined : publicSharedCache);
  const publicSource = options.publicSource || verifiedPublicReadingSource;
  const maximumEntries = options.maxEntries ?? 128, maximumBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const values = new Map<string, { fields: ReadingFields[]; bytes: number }>();
  const flights = new Map<string, Promise<ReadingFields[]>>();
  let retainedBytes = 0;
  return async <T extends { text: string }>(lines: readonly T[], language: ReadingLanguage, source: { publicReadingProof?: unknown } = {}): Promise<Array<T & ReadingFields>> => {
    if (lines.length > 400 || lines.reduce((total, line) => total + line.text.length, 0) > 20_000) throw new RangeError("Lyrics exceed reading limits");
    const texts = lines.map(line => ({ text: line.text }));
    const key = createHash("sha256").update(JSON.stringify([language, readingEngine(language), READING_VERSION, JAPANESE_READING_VERSION, texts])).digest("hex");
    const hit = values.get(key);
    let fields: ReadingFields[];
    if (hit) {
      values.delete(key); values.set(key, hit); fields = hit.fields;
    } else {
      let pending = flights.get(key);
      if (!pending) {
        pending = Promise.resolve().then(async () => {
          const eligible = shared && publicSource(texts.map(line => line.text), source.publicReadingProof);
          if (eligible) {
            const saved = await shared!.get(key).catch(() => undefined) as Partial<SharedTransform> | undefined;
            if (saved?.version === 1 && saved.key === key && saved.language === language && saved.engine === readingEngine(language)
              && validFields(saved.fields, texts.length, readingEngine(language))) return saved.fields;
          }
          const result = await transform(texts, language);
          if (eligible && validFields(result, texts.length, readingEngine(language))) {
            const fields = result.map(({ romanized, readingReviewNeeded, readingEngine }) => ({ romanized, readingReviewNeeded, readingEngine }));
            await shared!.set(key, { version: 1, key, language, engine: readingEngine(language), fields }, 24 * 60 * 60).catch(() => {});
          }
          return result;
        }).then(result => {
          if (result.length !== texts.length || result.some(line => typeof line.romanized !== "string" || typeof line.readingReviewNeeded !== "boolean" || line.readingEngine !== readingEngine(language))) throw new Error("Invalid reading transformation");
          const fields = result.map(({ romanized, readingReviewNeeded, readingEngine }) => ({ romanized, readingReviewNeeded, readingEngine }));
          const bytes = key.length * 2 + JSON.stringify(fields).length * 2;
          if (maximumEntries > 0 && bytes <= maximumBytes) {
            const replaced = values.get(key); if (replaced) retainedBytes -= replaced.bytes;
            values.set(key, { fields, bytes }); retainedBytes += bytes;
            while (values.size > maximumEntries || retainedBytes > maximumBytes) {
              const oldest = values.keys().next().value!;
              retainedBytes -= values.get(oldest)!.bytes; values.delete(oldest);
            }
          }
          return fields;
        }).finally(() => { if (flights.get(key) === pending) flights.delete(key); });
        // The retained flight index is bounded even during bursts of distinct songs.
        if (flights.size < 64) flights.set(key, pending);
      }
      fields = await pending;
    }
    return lines.map((line, index) => ({ ...line, ...fields[index] }));
  };
}

export const cachedLyricReadings = createReadingTransformCache();
