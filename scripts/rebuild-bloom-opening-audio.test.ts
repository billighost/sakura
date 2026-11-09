import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {bloomOpeningScore} from "../src/rebuild/bloom/openingAudio";
import {BLOOM_WORLDS} from "../src/rebuild/bloom/worlds/registry";

describe("original Bloom opening scores",()=>{
 it("gives every world a distinct instrumental phrase and a quiet resolution",()=>{
  const scores=BLOOM_WORLDS.map(world=>bloomOpeningScore(world.id));
  assert.equal(new Set(scores.map(score=>JSON.stringify(score.notes.map(note=>[note.at,note.midi,note.instrument])))).size,BLOOM_WORLDS.length);
  for(const score of scores){
   assert.ok(score.notes.length>=40);
   assert.ok(score.notes.some(note=>note.instrument==="string"),`${score.world} has a harmonic bed`);
   assert.ok(score.notes.some(note=>note.instrument==="bell"),`${score.world} has a luminous answer`);
   assert.ok(score.notes.some(note=>note.at>=14),`${score.world} resolves after its reveal`);
   for(const note of score.notes){
    assert.ok(Number.isFinite(note.at)&&note.at>=0);
    assert.ok(note.duration>0&&note.at+note.duration<=score.duration+.1);
    assert.ok(note.gain>0&&note.gain<.1);
    assert.ok(note.midi>=40&&note.midi<=95);
    assert.ok(Math.abs(note.pan)<=1);
   }
  }
 });
 it("keeps the saved world's composition reproducible while varying its key by seed",()=>{
  assert.deepEqual(bloomOpeningScore("china",452),bloomOpeningScore("china",452));
  const variants=Array.from({length:30},(_,seed)=>bloomOpeningScore("china",seed+1).notes[0].midi);
  assert.equal(new Set(variants).size,3);
 });
 it("gives legacy designs the score of their resolved artwork",()=>{
  assert.deepEqual(bloomOpeningScore("herbarium",22),bloomOpeningScore("sakura",22));
  assert.deepEqual(bloomOpeningScore("nocturne",22),bloomOpeningScore("cosmos",22));
  assert.deepEqual(bloomOpeningScore("risograph",22),bloomOpeningScore("glass",22));
 });
});
