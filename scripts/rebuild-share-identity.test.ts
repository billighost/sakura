import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicShareReader } from "../src/rebuild/data/shares";
import type { PublicShare } from "../src/rebuild/player/SharedSong";
import { lyricCacheKey } from "../src/rebuild/lyrics/provider";
import { recordingLyricIdentity } from "../src/rebuild/lyrics/recordingIdentity";

test("recording lyric identity keeps edition, language and all verified credits", () => {
  const identity = recordingLyricIdentity({ id: "canonical", title: "Song", artists: ["Lead"], albumTitle: "Album", durationMs: 180_000,
    metadata: { language: "ja", alternateTitles: ["Alias"], version: { labels: ["Acoustic"] }, artistCredits: [{ name: "Lead" }, { name: "Guest" }] } });
  assert.deepEqual(identity.artists, ["Lead", "Guest"]);
  assert.equal(identity.versionLabel, "Acoustic");
  assert.equal(identity.language, "ja");
  assert.equal(identity.durationSeconds, 180);
  assert.notEqual(lyricCacheKey(identity), lyricCacheKey({ ...identity, versionLabel: "Live" }));
  assert.notEqual(lyricCacheKey(identity), lyricCacheKey({ ...identity, language: "en" }));
});

test("equivalent original/primary-credit metadata shares verification, meaningful versions remain separate", () => {
  const identity = { recordingId: "one", title: "Song", artist: "Lead", alternateTitles: ["Alias", "Another"] };
  assert.equal(lyricCacheKey(identity), lyricCacheKey({ ...identity, artists: ["Lead"], alternateTitles: ["Another", "Alias"], versionLabel: "Original recording" }));
  assert.notEqual(lyricCacheKey(identity), lyricCacheKey({ ...identity, versionLabel: "Acoustic" }));
  assert.notEqual(lyricCacheKey(identity), lyricCacheKey({ ...identity, artists: ["Lead", "Other"] }));
});

test("concurrent public reads share one query and a later deletion is immediately visible", async () => {
  const slug = "abcdefghijklmnop";
  let calls = 0, deleted = false;
  const share = { slug, kind: "track", payload: { title: "Fixture" } } as PublicShare;
  const read = createPublicShareReader(async () => { calls++; return deleted ? undefined : share; });
  const [page, api] = await Promise.all([read(slug), read(slug)]);
  assert.equal(page, share); assert.equal(api, share); assert.equal(calls, 1);
  deleted = true;
  assert.equal(await read(slug), undefined); assert.equal(calls, 2);
  assert.equal(await read("invalid"), undefined); assert.equal(calls, 2);
});

test("a failed public-share query is never retained as a missing share", async () => {
  let calls = 0;
  const read = createPublicShareReader(async () => { if (++calls === 1) throw new Error("DB outage"); return undefined; });
  await assert.rejects(read("abcdefghijklmnop"), /DB outage/);
  assert.equal(await read("abcdefghijklmnop"), undefined);
  assert.equal(calls, 2);
});
