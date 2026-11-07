import test from 'node:test';
import assert from 'node:assert/strict';
import { planMixes } from './planner.ts';
const context = {
  seed: '2026-11-07', nowMs: 1_000_000, heardRecordings: new Set(), familiarArtists: new Set(),
  blockedRecordings: new Set(), blockedArtists: new Set(), snoozedUntil: new Map(), recentPlays: new Map(), recentWindowMs: 5000,
};
const spec = (id, overrides = {}) => ({ id, kind: 'daily', genres: ['j-pop'], size: 12, minimum: 8, maxPerArtist: 2, maximumOverlap: 0.2, ...overrides });
const candidates = Array.from({length: 90},(_,i) => ({ recordingId: `rec-${i}`, artistId: `artist-${Math.floor(i/3)}`,
  genres: ['J-Pop'], affinity: 0.8, popularity: i/90 }));
test('three daily mixes have distinct canonical recordings and pairwise overlap within budget', () => {
  const mixes = planMixes([spec('1'),spec('2'),spec('3')], [...candidates,candidates[0]], context);
  for (const mix of mixes) { assert.equal(mix.status,'ready'); assert.equal(mix.recordingIds.length,12); assert.equal(new Set(mix.recordingIds).size,12); }
  for (let a=0;a<mixes.length;a++) for (let b=a+1;b<mixes.length;b++) {
    const common=mixes[a].recordingIds.filter(id => mixes[b].recordingIds.includes(id)); assert.ok(common.length <= 2);
  }
  for (const mix of mixes) {
    const count = new Map();
    for (const id of mix.recordingIds) { const artist=candidates.find(c => c.recordingId===id).artistId; count.set(artist,(count.get(artist)??0)+1); }
    assert.ok([...count.values()].every(n=>n<=2));
  }
});
test('canonical duplicates cannot bypass blocked, recent-play or snoozed exclusions', () => {
  const blocked={...context,blockedRecordings:new Set(['rec-0']),blockedArtists:new Set(['artist-1']),recentPlays:new Map([['rec-7',999999]]),snoozedUntil:new Map([['rec-8',1000001]])};
  const mix=planMixes([spec('daily')],[...candidates,{...candidates[0],affinity:100}],blocked)[0];
  assert.ok(mix.recordingIds.every(id=>!['rec-0','rec-3','rec-4','rec-5','rec-7','rec-8'].includes(id)));
});
test('discovery and deep cuts answer different listening questions', () => {
  const profile={...context,heardRecordings:new Set(candidates.slice(0,3).map(c=>c.recordingId)),familiarArtists:new Set(['artist-0','artist-1','artist-2','artist-3','artist-4','artist-5'])};
  const mixes=planMixes([spec('discover',{kind:'discover'}),spec('deep',{kind:'deep-cuts',size:8,minimum:4,maximumOverlap:0})],candidates,profile);
  for (const id of mixes[0].recordingIds) assert.ok(!profile.familiarArtists.has(candidates.find(c=>c.recordingId===id).artistId));
  assert.equal(mixes[1].status,'ready');
  for (const id of mixes[1].recordingIds) { assert.ok(!profile.heardRecordings.has(id)); assert.ok(profile.familiarArtists.has(candidates.find(c=>c.recordingId===id).artistId)); }
});
test('genre isolation keeps overlapping artist seeds from flattening daily mixes', () => {
  const mix=planMixes([spec('metal',{genres:['metal']})],candidates,context)[0];
  assert.equal(mix.status,'insufficient-candidates'); assert.deepEqual(mix.recordingIds,[]);
});
test('same seed is reproducible and a new day rotates candidates', () => {
  const first=planMixes([spec('daily')],candidates,context);
  assert.deepEqual(planMixes([spec('daily')],[...candidates].reverse(),context),first);
  assert.notDeepEqual(planMixes([spec('daily')],candidates,{...context,seed:'2026-11-08'}),first);
});
test('sparse pools remain empty rather than repeating the same list under a new name', () => {
  const mix=planMixes([spec('a'),spec('b')],candidates.slice(0,15),context);
  assert.equal(mix[0].status,'ready'); assert.equal(mix[1].status,'insufficient-candidates'); assert.deepEqual(mix[1].recordingIds,[]);
});
test('repeat admits recent recordings deliberately but only previously heard ones', () => {
  const played={...context,heardRecordings:new Set(candidates.slice(0,30).map(c=>c.recordingId)),recentPlays:new Map(candidates.slice(0,30).map(c=>[c.recordingId,999999]))};
  const mix=planMixes([spec('repeat',{kind:'repeat'})],candidates,played)[0];
  assert.equal(mix.status,'ready'); assert.ok(mix.recordingIds.every(id=>played.heardRecordings.has(id)));
});
test('invalid overlap contracts fail explicitly', () => {
  assert.throws(()=>planMixes([spec('bad',{maximumOverlap:1.1})],candidates,context));
});
