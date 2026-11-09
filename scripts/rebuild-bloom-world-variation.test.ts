import assert from "node:assert/strict";
import { test } from "node:test";
import { listeningPaintingLayout, paintingFraction } from "../src/rebuild/bloom/worlds/illustrations/layout";

test("saved illustration geometry is stable while a new seed gives the same world a fresh composition", () => {
  const first = listeningPaintingLayout(182761, 1, 5);
  assert.deepEqual(first, listeningPaintingLayout(182761, 1, 5));
  assert.notDeepEqual(first, listeningPaintingLayout(182762, 1, 5));
  assert.equal(new Set([0, 1, 2, 3].map(composition => listeningPaintingLayout(182761, composition, 5).layout)).size, 4);
  assert.notDeepEqual(first, listeningPaintingLayout(182761, 1, 6));
});

test("hour-band ornament uses retained measurements and ignores invalid inputs", () => {
  const model = listeningPaintingLayout(19, 0, 8, { timeZone:"Africa/Lagos", hourBands: [
    { id:"dawn", audibleMs:1000, share:.9 }, { id:"day", audibleMs:3000, share:.1 },
    { id:"evening", audibleMs:NaN, share:.4 }, { id:"night", audibleMs:-20, share:.2 },
  ] });
  assert.equal(model.measured, true);
  assert.deepEqual(model.bands.map(band => band.share), [.25, .75, 0, 0]);
  assert.equal(model.bands.reduce((total, band) => total + (band.audibleMs || 0), 0), 4000);
  assert.ok(model.bands[1].scale > model.bands[0].scale);
});

test("unrevealed hour data remains decorative without invented measurements", () => {
  const model = listeningPaintingLayout(19, 2, 4, { timeZone:"Africa/Lagos", audibleMs:60000 });
  assert.equal(model.measured, false);
  assert.ok(model.bands.every(band => band.audibleMs === undefined && band.share === undefined));
  for (const seed of [0, -1, 4294967295, NaN, Infinity]) assert.ok(paintingFraction(seed, 9) >= 0 && paintingFraction(seed, 9) < 1);
});
