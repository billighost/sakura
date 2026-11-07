import assert from "node:assert/strict";
import { test } from "node:test";
import { preferencesPatch, DEFAULT_SETTINGS, ProductError } from "../src/rebuild/data/validation";
import { settingsFields } from "../src/rebuild/app/preferences";
import { AUDIO_TECHNOLOGIES } from "../src/rebuild/audio/presets";

test("audio technology defaults to bypass and accepts every shipped mode", () => {
  assert.equal(DEFAULT_SETTINGS.audioTechnology, "none");
  for (const mode of AUDIO_TECHNOLOGIES) assert.deepEqual(preferencesPatch({ audioTechnology: mode.id }), { audioTechnology: mode.id });
  assert.deepEqual(preferencesPatch({ audioQuality: "high", audioTechnology: "night" }), { audioQuality: "high", audioTechnology: "night" });
});
test("settings validation rejects unimplemented or malformed audio modes", () => {
  for (const audioTechnology of ["ai-restoration", "", 1, null, [], {}]) {
    assert.throws(() => preferencesPatch({ audioTechnology }), (error: unknown) => error instanceof ProductError && error.status === 400);
  }
});
test("offline preference projection keeps the audio choice and drops server metadata", () => {
  assert.deepEqual(settingsFields({ audioTechnology: "headphones", revision: 12, accountId: "other-account" }), { audioTechnology: "headphones" });
});
