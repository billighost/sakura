import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { cachedPreferences, preferenceFieldRevisions, readPreferenceDraft, rebasePreferences, settingsFields, writePreferenceDraft } from "../src/rebuild/app/preferences";
import { DEFAULT_SETTINGS, preferencesPatch, ProductError } from "../src/rebuild/data/validation";
import { miniLyricCue } from "../src/rebuild/player/miniLyric";
import type { UserSettings } from "../src/rebuild/app/types";

test("Japanese reading is a validated account preference that accepts an explicit disable", () => {
  assert.equal(DEFAULT_SETTINGS.japaneseReading, false);
  assert.deepEqual(preferencesPatch({ japaneseReading: true }), { japaneseReading: true });
  assert.deepEqual(preferencesPatch({ japaneseReading: false }), { japaneseReading: false });
  assert.deepEqual(settingsFields({ japaneseReading: true, revision: 4 }), { japaneseReading: true });
  assert.deepEqual(settingsFields({ japaneseReading: false }), { japaneseReading: false });
  for (const japaneseReading of ["true", 1, null, [], {}]) {
    assert.throws(() => preferencesPatch({ japaneseReading }), error => error instanceof ProductError && error.status === 400);
    assert.deepEqual(settingsFields({ japaneseReading }), {});
  }
});

test("reading preferences survive reloads without crossing account boundaries and retain disable intents", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const account = randomUUID(), another = randomUUID();
  const settings: UserSettings = { ...DEFAULT_SETTINGS, seedArtists: [], seedGenres: [], seedArtistSelections: [], onboarded: true };
  await writePreferenceDraft(account, { ...settings, japaneseReading: true }, true, { japaneseReading: true }, { baseSettings: { japaneseReading: false } });
  assert.equal(cachedPreferences(account).japaneseReading, true);
  assert.equal((await readPreferenceDraft(account))?.settings.japaneseReading, true);
  assert.equal(cachedPreferences(another).japaneseReading, undefined);
  await writePreferenceDraft(account, { ...settings, japaneseReading: false }, true, { japaneseReading: false }, { baseSettings: { japaneseReading: true } });
  assert.equal(cachedPreferences(account).japaneseReading, false);
  assert.deepEqual((await readPreferenceDraft(account))?.pendingPatch, { japaneseReading: false });
});

test("reading choices participate in offline rebase and newer-device conflict resolution", () => {
  assert.deepEqual(rebasePreferences({ japaneseReading: true }, { japaneseReading: false }, { japaneseReading: false }), { pending: { japaneseReading: true }, conflicts: [] });
  assert.deepEqual(rebasePreferences({ japaneseReading: false }, { japaneseReading: true }, { japaneseReading: true }), { pending: { japaneseReading: false }, conflicts: [] });
  assert.deepEqual(rebasePreferences({ japaneseReading: false }, { japaneseReading: true }, { japaneseReading: true }, { base: { japaneseReading: 2 }, remote: { japaneseReading: 4 } }), { pending: {}, conflicts: ["japaneseReading"] });
  assert.deepEqual(preferenceFieldRevisions({ fieldRevisions: { japaneseReading: 4, secret: 5 } }), { japaneseReading: 4 });
});

test("current-player readings use the same verified time window as the displayed words", () => {
  const lines = [
    { text: "君の声", romanized: "kimi no koe", start: 2, end: 5 },
    { text: "", romanized: "", start: 5, end: 8 },
    { text: "未来", romanized: "mirai", start: 8, end: 11 },
    { text: "our tomorrow", romanized: "our tomorrow", start: 8, end: 11 },
  ];
  assert.equal(miniLyricCue(lines, 2000)?.romanized, "kimi no koe");
  assert.equal(miniLyricCue(lines, 5000), null);
  assert.equal(miniLyricCue(lines, 7000), null);
  assert.equal(miniLyricCue(lines, 8000)?.romanized, "mirai · our tomorrow");
  assert.equal(miniLyricCue(lines, 11000), null);
  assert.equal(miniLyricCue([{ text: "only words", romanized: "only words", start: 0, end: 5 }], 1000)?.romanized, undefined);
});
