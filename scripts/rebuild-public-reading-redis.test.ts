import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicReadingSources } from "../src/rebuild/lyrics/publicReadingSources";
import { createReadingTransformCache } from "../src/rebuild/lyrics/readingTransforms";
import { readingEngine } from "../src/rebuild/lyrics/language";

const secret = "test-only-public-reading-secret-32-characters";
const source = { provider: "lrclib", providerTrackId: 1 };
const texts = ["公開された言葉", "", "公開された言葉"];
const fields = texts.map((_, index) => ({ romanized: "public pronunciation " + index, readingReviewNeeded: false, readingEngine: readingEngine("ja") }));

test("public proof carries no lyrics/account data and verifies across independent instances", () => {
  const now = () => 1000;
  const producer = new PublicReadingSources({ secret, now }), reader = new PublicReadingSources({ secret, now });
  const proof = producer.register(texts, source)!;
  assert.equal(reader.isPublic(texts, proof), true);
  const payload = JSON.parse(Buffer.from(proof.split(".")[0], "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(payload).sort(), ["digest", "expiresAt", "issuedAt", "provider", "sourceId", "v"].sort());
  assert.equal(JSON.stringify(payload).includes(texts[0]), false);
  assert.equal(reader.isPublic([texts[0], texts[2]], proof), false);
  assert.equal(reader.isPublic(["私の未公開の草稿"], proof), false);
  assert.equal(reader.isPublic(texts, proof.slice(0, -1) + (proof.endsWith("a") ? "b" : "a")), false);
  assert.equal(reader.isPublic(texts, "x".repeat(1025)), false);
  assert.equal(new PublicReadingSources({ secret, now: () => 3_601_001 }).isPublic(texts, proof), false);
  assert.equal(new PublicReadingSources({ secret: "other-test-public-source-secret-32", now }).isPublic(texts, proof), false);
});

test("private drafts and altered/expired proofs make zero Redis commands", async () => {
  const proof = new PublicReadingSources({ secret, now: () => 1000 }).register(texts, source)!;
  let commands = 0;
  const shared = { get: async () => { commands++; return undefined; }, set: async () => { commands++; } };
  const registry = new PublicReadingSources({ secret, now: () => 1000 });
  const cache = createReadingTransformCache({ shared, publicSource: (lines, token) => registry.isPublic(lines, token),
    transform: async (lines, language) => lines.map(() => ({ romanized: "device-only", readingReviewNeeded: true, readingEngine: readingEngine(language) })) });
  await cache([{ text: "Private unpublished draft", start: 1 }], "ja");
  await cache([{ text: "Private unpublished draft with a public proof", start: 1 }], "ja", { publicReadingProof: proof });
  await cache(texts.slice(0, 1).map(text => ({ text })), "ja", { publicReadingProof: proof });
  await cache(texts.map(text => ({ text })), "ja", { publicReadingProof: proof.slice(0, -1) + "!" });
  assert.equal(commands, 0);
});

test("public Redis L2 works in a cold independent cache and retains each caller's source timing", async () => {
  const proof = new PublicReadingSources({ secret }).register(texts, source)!;
  const saved = new Map<string, unknown>();
  let gets = 0, sets = 0, transforms = 0;
  const shared = { get: async (key: string) => { gets++; return saved.get(key); }, set: async (key: string, value: unknown) => { sets++; saved.set(key, value); } };
  const create = () => {
    const registry = new PublicReadingSources({ secret });
    return createReadingTransformCache({ shared, publicSource: (lines, token) => registry.isPublic(lines, token), transform: async () => { transforms++; return fields; } });
  };
  const one = create(), two = create();
  const first = texts.map((text, index) => ({ text, start: index, end: index + 1, words: [{ text, start: index }], caller: "one" }));
  const second = texts.map((text, index) => ({ text, start: index + 10, end: index + 11, words: [{ text, start: index + 10 }], caller: "two" }));
  await one(first, "ja", { publicReadingProof: proof });
  const result = await two(second, "ja", { publicReadingProof: proof });
  assert.equal(transforms, 1); assert.equal(gets, 2); assert.equal(sets, 1);
  for (let index = 0; index < result.length; index++) {
    const { romanized, readingReviewNeeded, readingEngine: engine, ...original } = result[index];
    assert.deepEqual(original, second[index]); assert.equal(romanized, fields[index].romanized); assert.equal(readingReviewNeeded, false); assert.equal(engine, readingEngine("ja"));
  }
  await two(second, "ja", { publicReadingProof: proof });
  assert.equal(gets, 2, "warm L1 never needs Redis");
  const envelope = [...saved.values()][0] as { fields: object[] };
  assert.deepEqual(Object.keys(envelope.fields[0]).sort(), ["readingEngine", "readingReviewNeeded", "romanized"]);
});

test("malformed L2 identities/fields and Redis outages recompute instead of failing readings", async () => {
  const proof = new PublicReadingSources({ secret }).register(texts, source)!;
  for (const broken of [undefined, { version: 1, key: "wrong", language: "ja", engine: readingEngine("ja"), fields }, { fields: "invalid" }]) {
    let transforms = 0;
    const registry = new PublicReadingSources({ secret });
    const cache = createReadingTransformCache({ publicSource: (lines, token) => registry.isPublic(lines, token),
      shared: { get: async () => broken, set: async () => { throw new Error("Redis unavailable"); } },
      transform: async () => { transforms++; return fields; } });
    assert.equal((await cache(texts.map(text => ({ text })), "ja", { publicReadingProof: proof }))[0].romanized, fields[0].romanized);
    assert.equal(transforms, 1);
  }
  const registry = new PublicReadingSources({ secret });
  const cache = createReadingTransformCache({ publicSource: (lines, token) => registry.isPublic(lines, token), shared: {
    get: async () => { throw new Error("Redis down"); }, set: async () => { throw new Error("Redis down"); },
  }, transform: async () => fields });
  assert.equal((await cache(texts.map(text => ({ text })), "ja", { publicReadingProof: proof })).length, texts.length);
});

test("public edits use new content keys and hash-only registry obeys its capacity", async () => {
  const registry = new PublicReadingSources({ maxEntries: 2 });
  registry.register(["one"], source); registry.register(["two"], source); registry.register(["three"], source);
  assert.equal(registry.isPublic(["one"]), false); assert.equal(registry.isPublic(["two"]), true); assert.equal(registry.isPublic(["three"]), true);
  assert.equal(registry.isPublic(["three", ""]), false);
  const signing = new PublicReadingSources({ secret });
  const proof = signing.register(texts, source)!, edited = ["公開された変更後の言葉"];
  const editedProof = signing.register(edited, source)!;
  const reader = new PublicReadingSources({ secret }), keys: string[] = [];
  const cache = createReadingTransformCache({ publicSource: (lines, token) => reader.isPublic(lines, token),
    shared: { get: async key => { keys.push(key); return undefined; }, set: async () => {} },
    transform: async (lines, language) => lines.map(() => ({ romanized: "public", readingReviewNeeded: false, readingEngine: readingEngine(language) })) });
  await cache(texts.map(text => ({ text })), "ja", { publicReadingProof: proof });
  await cache(edited.map(text => ({ text })), "ja", { publicReadingProof: editedProof });
  assert.equal(keys.length, 2); assert.notEqual(keys[0], keys[1]); assert.ok(keys.every(key => !key.includes(texts[0]) && !key.includes(edited[0])));
});
