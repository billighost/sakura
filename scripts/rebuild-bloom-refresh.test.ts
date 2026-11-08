import assert from "node:assert/strict";
import {test} from "node:test";
import {sameBloomStory,mergeBloomRefresh} from "../src/rebuild/bloom/refresh";
import type {BloomRecap} from "../src/rebuild/bloom/uiTypes";

function story():BloomRecap{return {id:"monthly-2026-10",version:3,worldId:"sakura",timeZone:"Africa/Lagos",period:"monthly",periodStart:"2026-09-30T23:00:00Z",periodEnd:"2026-10-31T23:00:00Z",publishAt:"2026-10-31T23:00:00Z",expiresAt:"2026-11-23T23:00:00Z",snapshotCreatedAt:"2026-11-08T10:00:00Z",status:"available",chapterCount:2,summary:{audibleMs:60000,playCount:1,recordingCount:1,activeDays:1},chapters:[{id:"time",kind:"time",title:"Listening",prompt:"",revealed:false,stat:null,relatedRecording:null},{id:"songs",kind:"songs",title:"Songs",prompt:"",revealed:false,stat:null,relatedRecording:null}]};}

test("an unchanged background refresh preserves opened chapters and disclosed artwork",()=>{
 const current=story(),incoming=story();current.chapters[0]={...current.chapters[0],revealed:true,stat:{label:"listened",value:"1 minute",unit:""}};current.listening={timeZone:current.timeZone,audibleMs:60000};
 assert.equal(sameBloomStory(current,incoming),true);
 const merged=mergeBloomRefresh(current,incoming);assert.equal(merged.chapters[0].revealed,true);assert.deepEqual(merged.chapters[0].stat,current.chapters[0].stat);assert.equal(merged.listening?.audibleMs,60000);
});

test("refresh can add another device's reveal without discarding the current journey",()=>{
 const current=story(),incoming=story();current.chapters[0].revealed=true;incoming.chapters[1].revealed=true;
 const merged=mergeBloomRefresh(current,incoming);assert.deepEqual(merged.chapters.map(chapter=>chapter.revealed),[true,true]);
});

test("a rebuilt period after erasure is a different story even with identical totals",()=>{
 const erased=story(),rebuilt=story();erased.chapters[0].revealed=true;rebuilt.snapshotCreatedAt="2026-11-08T10:01:00Z";
 assert.equal(sameBloomStory(erased,rebuilt),false);assert.equal(mergeBloomRefresh(erased,rebuilt).chapters[0].revealed,false);
});

test("legacy stories without a creation marker remain compatible with ordinary refresh",()=>{
 const current=story(),incoming=story();delete current.snapshotCreatedAt;delete incoming.snapshotCreatedAt;current.version=incoming.version=1;
 current.chapters[0].revealed=true;assert.equal(mergeBloomRefresh(current,incoming).chapters[0].revealed,true);
 incoming.timeZone="America/New_York";assert.equal(sameBloomStory(current,incoming),false);
});
