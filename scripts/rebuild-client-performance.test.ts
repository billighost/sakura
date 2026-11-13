import test from "node:test";
import assert from "node:assert/strict";
import {ClientPerformanceJournal} from "../src/rebuild/app/clientPerformance";
test("numeric client diagnostics remain bounded and reject identifiers and invalid measurements",()=>{
 let now=0;const journal=new ClientPerformanceJournal(()=>now);
 journal.begin("playback");now=42;journal.finish("playback");journal.finish("playback");assert.deepEqual(journal.snapshot(),[{name:"playback",value:42,at:42,kind:"journey"}]);
 journal.record("private-account-id",99,"vital");journal.record("LCP",Infinity,"vital");journal.record("LCP",-1,"vital");assert.equal(journal.snapshot().length,1);
 for(let i=0;i<200;i++)journal.record("INP",i,"vital");const snapshot=journal.snapshot();assert.equal(snapshot.length,128);snapshot[0].value=-1;assert.notEqual(journal.snapshot()[0].value,-1);
});
test("superseded playback records the latest interaction and keeps independent startup clocks",()=>{
 let now=0;const journal=new ClientPerformanceJournal(()=>now);journal.begin("startup");journal.begin("playback");now=100;journal.begin("playback");now=125;journal.finish("playback");journal.finish("startup");assert.deepEqual(journal.snapshot().map(({name,value})=>({name,value})),[{name:"playback",value:25},{name:"startup",value:125}]);
});
