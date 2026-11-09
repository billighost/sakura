import assert from "node:assert/strict";
import test from "node:test";
import {personalizedHeroPicks,HERO_REFRESH_MS} from "../src/rebuild/recommendations/hero";
import type {TasteTrack,ListeningEvidence} from "../src/rebuild/recommendations/personalization";

const now=Date.parse("2026-11-09T12:01:00Z");
const song=(id:string,artist=id,genre="Jazz"):TasteTrack=>({id,title:id,artists:[artist],artistId:artist,genres:[genre],durationMs:180000});
const songs=Array.from({length:40},(_,index)=>song("song-"+index,"artist-"+index,index<20?"Jazz":"Metal"));
const options={nowMs:now,seed:"account-one",settings:{seedGenres:["Jazz"],timeAware:false}};

test("hero songs use taste-ranked candidates, keep recommendations stable within ten minutes, and rotate both surfaces",()=>{
 const first=personalizedHeroPicks(songs,options);
 assert.deepEqual(personalizedHeroPicks(songs,{...options,nowMs:now+60000}),first);
 const home=new Set<string>(),discover=new Set<string>();
 for(let window=0;window<16;window++){
  const picks=personalizedHeroPicks(songs,{...options,nowMs:now+window*HERO_REFRESH_MS});
  assert.ok(picks.home&&picks.discover);
  assert.notEqual(picks.home.track.id,picks.discover.track.id);
  assert.equal(picks.home.track.genres?.[0],"Jazz");
  assert.equal(picks.discover.track.genres?.[0],"Jazz");
  assert.match(picks.home.reason,/Jazz/);
  assert.equal(picks.refreshAt,(Math.floor((now+window*HERO_REFRESH_MS)/HERO_REFRESH_MS)+1)*HERO_REFRESH_MS);
  home.add(picks.home.track.id);discover.add(picks.discover.track.id);
 }
 assert.equal(home.size,16);assert.ok(discover.size>8);
});

test("hero selection is account scoped and honors exclusions and explicit-content choices",()=>{
 assert.notDeepEqual(personalizedHeroPicks(songs,options),personalizedHeroPicks(songs,{...options,seed:"account-two"}));
 const picks=personalizedHeroPicks([song("blocked"),{...song("explicit"),explicit:true},song("safe")],{
  ...options,settings:{explicitContent:false},feedback:[{target:"recording",targetId:"blocked",kind:"block"}],
 });
 assert.equal(picks.home?.track.id,"safe");assert.equal(picks.discover?.track.id,"safe");
});

test("paused learning does not rank songs or explain recommendations from retained history",()=>{
 const history:ListeningEvidence[]=[{recordingId:"song-3",audibleMs:3600000,playCount:20,completedCount:20,skippedCount:0}];
 const paused={...options,settings:{learnFromListening:false,timeAware:false}};
 assert.deepEqual(personalizedHeroPicks(songs,{...paused,history}),personalizedHeroPicks(songs,{...paused,history:[]}));
});

test("empty and sparse accounts never receive fabricated songs",()=>{
 const none=personalizedHeroPicks([],options);assert.equal(none.home,null);assert.equal(none.discover,null);
 const single=personalizedHeroPicks([song("only")],options);assert.equal(single.home?.track.id,"only");assert.equal(single.discover?.track.id,"only");
});
