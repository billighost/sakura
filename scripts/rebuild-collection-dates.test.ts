import assert from "node:assert/strict";
import test from "node:test";
import { collectionDate } from "../src/rebuild/core/collectionDate";
import { card } from "../src/rebuild/data/catalog";
import { musicTrack } from "../src/rebuild/app/types";

const source={id:"recording",metadata:{title:"A song",artists:["A voice"],durationMs:180000},references:[{provider:"deezer",id:"1"}]};
const iso="2026-11-08T10:30:00.000Z";

test("collection timestamps survive the database card and client normalization",()=>{
 const projected=card({...source,addedAt:new Date(iso)});
 assert.equal(projected.addedAt,iso);
 assert.equal(musicTrack(projected as unknown as Record<string,unknown>).addedAt,iso);
 assert.equal(musicTrack({...projected,addedAt:Date.parse(iso)}).addedAt,iso);
});

test("unavailable membership timestamps are not inferred from recording metadata",()=>{
 const projected=card({...source,metadata:{...source.metadata,addedAt:iso}});
 assert.equal(projected.addedAt,undefined);
 assert.equal(musicTrack(projected as unknown as Record<string,unknown>).addedAt,undefined);
 for(const invalid of [null,undefined,"", "invalid date", Infinity,NaN,Number.MAX_VALUE,{},new Date(NaN)]) {
  assert.equal(collectionDate(invalid),undefined);
  assert.equal(musicTrack({...source,addedAt:invalid}).addedAt,undefined);
 }
});

test("saved audio completion timestamps normalize without changing their instant",()=>{
 const savedAt=Date.parse(iso);
 assert.equal(collectionDate(savedAt),iso);
 assert.equal(collectionDate("2026-11-08T11:30:00+01:00"),iso);
});
