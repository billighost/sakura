import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import vm from "node:vm";
import {test} from "node:test";
import ts from "typescript";
import {musicTrack} from "../src/rebuild/app/types";
import {validOfflineAudio} from "../src/rebuild/app/offline";
import {audibleIncrement,listeningOutcome} from "../src/rebuild/app/listeningEvidence";

const compiled=ts.transpileModule(readFileSync("src/rebuild/bloom/useBloomAudio.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id="10000000-0000-4000-8000-000000000001",accountId="90000000-0000-4000-8000-000000000001";
const raw={id,title:"Fixture song",artists:["Fixture artist"],durationMs:180000,reference:{provider:"deezer",id:"1"}};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(options:{offline?:boolean;saved?:unknown;deferResolve?:boolean}={}){
 let wall=0,choice=0,resumed=0,closed=false,queued=false,refSlot=0,stateSlot=0,effectSlot=0;
 const resolvers:Array<(response:unknown)=>void>=[];
 const deliveries:Array<Record<string,unknown>>=[],requests:string[]=[],audios:AudioFixture[]=[],refs:Array<{current:unknown}>=[],states:unknown[]=[],hooks:Array<{deps?:unknown[];cleanup?:()=>void}>=[],effects:Array<{slot:number;effect:()=>void|(()=>void)}>=[],windowEvents=new Map<string,Set<(event:Event)=>void>>(),intervals:Array<()=>void>=[];
 let music={account:{id:accountId},settings:{privateSession:false,learnFromListening:true},volume:.8,status:"playing",track:{id:"original"},currentEntryId:"original-entry",getPlaybackChoiceVersion:()=>choice,pause(){choice++;music={...music,status:"paused"};schedule();},togglePlay(){choice++;resumed++;music={...music,status:"playing"};schedule();}};
 class AudioFixture{
  preload="";src="";volume=.8;muted=false;paused=true;seeking=false;ended=false;duration=180;currentTime=0;events=new Map<string,Set<()=>void>>();
  constructor(){audios.push(this);}
  addEventListener(name:string,callback:()=>void){const group=this.events.get(name)||new Set();group.add(callback);this.events.set(name,group);}
  emit(name:string){for(const callback of this.events.get(name)||[])callback();}
  async play(){this.paused=false;this.emit("playing");}
  pause(){this.paused=true;this.emit("pause");}
  removeAttribute(){this.src="";}load(){this.currentTime=0;}
 }
 function schedule(){if(queued||closed)return;queued=true;queueMicrotask(()=>{queued=false;if(!closed)render();});}
 const react={useRef(value:unknown){const slot=refSlot++;return refs[slot]||(refs[slot]={current:value});},useState(value:unknown){const slot=stateSlot++;if(slot>=states.length)states.push(value);return [states[slot],(next:unknown)=>{states[slot]=next;schedule();}];},useEffect(effect:()=>void|(()=>void),deps?:unknown[]){const slot=effectSlot++,previous=hooks[slot];if(!previous||!deps||deps.length!==previous.deps?.length||deps.some((dep,index)=>!Object.is(dep,previous.deps?.[index])))effects.push({slot,effect});hooks[slot]={deps,cleanup:previous?.cleanup};}};
 const exports:Record<string,unknown>={};
 const modules:Record<string,unknown>={react,"../app/MusicContext":{useMusic:()=>music},"../app/types":{musicTrack},"../app/playbackSource":{readyPlaybackFor:()=>undefined},"../app/recordingJob":{waitForRecording:async(value:unknown)=>value},"../app/listeningEvidence":{audibleIncrement,listeningOutcome},"../app/offline":{validOfflineAudio,localRead:async()=>options.saved,deliverListen:async(_account:string,chunk:Record<string,unknown>)=>{deliveries.push(chunk);return true;}},"../app/errors":{requestJson:async(path:string)=>{requests.push(path);if(options.deferResolve)return new Promise(resolve=>resolvers.push(resolve));return {status:"resolved",recording:{recordingId:id},playback:{url:"https://sakura.example/audio",fallbackUrl:"/audio"}};}},"../audio/engine":{MediaAudioEngine:class{initialized=false;requiresVolumeGraph=false;setVolume(){}setMode(){return Promise.resolve();}resume(){return Promise.resolve();}dispose(){}}}};
 vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},Audio:AudioFixture,navigator:{onLine:!options.offline},location:{origin:"https://sakura.example",href:"https://sakura.example/bloom"},URL,Blob,AbortController,crypto:webcrypto,performance:{now:()=>wall},Date,window:{addEventListener(name:string,callback:(event:Event)=>void){const group=windowEvents.get(name)||new Set();group.add(callback);windowEvents.set(name,group);},removeEventListener(name:string,callback:(event:Event)=>void){windowEvents.get(name)?.delete(callback);}},setInterval:(callback:()=>void)=>{intervals.push(callback);return intervals.length;},clearInterval:()=>{}});
 let api:{play:(raw:Record<string,unknown>,resumePlayback?:boolean)=>void;pause:()=>void;resume:()=>void;close:()=>void;stop:()=>void;message:string};
 function render(){refSlot=0;stateSlot=0;effectSlot=0;effects.length=0;api=(exports.useBloomAudio as ()=>typeof api)();for(const {slot,effect}of [...effects]){hooks[slot].cleanup?.();hooks[slot].cleanup=effect()||undefined;}}
 render();
 return {resolvers,resolve(){resolvers.at(-1)!({status:"resolved",recording:{recordingId:id},playback:{url:"https://sakura.example/audio",fallbackUrl:"/audio"}});},async account(next:string){music={...music,account:{id:next}};render();await tick();},async startMain(){music.togglePlay();await tick();},get api(){return api;},get media(){return audios.at(-1)!;},deliveries,requests,get resumed(){return resumed;},advance(ms:number){wall+=ms;audios.at(-1)!.currentTime+=ms/1000;},async settings(patch:Partial<typeof music.settings>){music={...music,settings:{...music.settings,...patch}};render();await tick();},flush(){for(const callback of intervals)callback();},clear(){for(const callback of windowEvents.get("sakura-personalization-cleared")||[])callback(new CustomEvent("sakura-personalization-cleared",{detail:{accountId,scope:"history"}}));},newPause(){music.pause();},finish(){const audio=audios.at(-1)!;audio.paused=true;audio.ended=true;audio.emit("ended");},destroy(){closed=true;for(const hook of [...hooks].reverse())hook.cleanup?.();}};
}

test("Bloom records completed audible playback once, including its final paused interval",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(180000);f.finish();await tick();f.api.stop();assert.equal(f.deliveries.reduce((sum,c)=>sum+Number(c.msPlayed),0),180000);assert.equal(f.deliveries.filter(c=>c.completed).length,1);assert.equal(f.deliveries.at(-1)?.finished,true);}finally{f.destroy();}
});

test("Bloom enters a likely highlight instead of replaying a long song's intro",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();assert.ok(f.media.currentTime>=60&&f.media.currentTime<=75);}finally{f.destroy();}
});

test("Bloom does not count its initial highlight seek as listening",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);f.media.emit("timeupdate");f.api.stop();assert.equal(f.deliveries.reduce((sum,chunk)=>sum+Number(chunk.msPlayed),0),1000);}finally{f.destroy();}
});

test("Bloom honors an analyzed chorus marker and leaves short recordings at the start",async()=>{
 const marked=fixture();try{marked.api.play({...raw,metadata:{title:raw.title,artists:raw.artists,durationMs:180000,chorusStartMs:42000}});await tick();assert.equal(marked.media.currentTime,42);}finally{marked.destroy();}
 const clamped=fixture();try{clamped.api.play({...raw,metadata:{title:raw.title,artists:raw.artists,durationMs:180000,highlightStartMs:179000}});await tick();assert.equal(clamped.media.currentTime,135);}finally{clamped.destroy();}
 const short=fixture();try{short.api.play({...raw,metadata:{title:raw.title,artists:raw.artists,durationMs:45000}});await tick();assert.equal(short.media.currentTime,0);}finally{short.destroy();}
});

test("Bloom seeking to the end does not manufacture completion",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);f.media.emit("timeupdate");f.media.currentTime=179;f.media.emit("timeupdate");f.advance(1000);f.finish();assert.equal(f.deliveries.reduce((sum,c)=>sum+Number(c.msPlayed),0),2000);assert.equal(f.deliveries.some(c=>c.completed),false);}finally{f.destroy();}
});

test("Bloom pause, mute and resume exclude silent media movement",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);f.media.muted=true;f.media.emit("volumechange");f.advance(9000);f.media.muted=false;f.media.emit("volumechange");f.advance(1000);f.api.pause();f.advance(9000);f.flush();f.api.resume();await tick();f.advance(1000);f.api.stop();assert.equal(f.deliveries.reduce((sum,c)=>sum+Number(c.msPlayed),0),3000);}finally{f.destroy();}
});

test("Bloom consent boundaries retire the old event and keep disabled listening unrecorded",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);await f.settings({learnFromListening:false});f.advance(9000);f.flush();await f.settings({learnFromListening:true});f.advance(1000);f.api.stop();assert.equal(f.deliveries.reduce((sum,c)=>sum+Number(c.msPlayed),0),2000);assert.equal(new Set(f.deliveries.map(c=>c.eventId)).size,2);}finally{f.destroy();}
});

test("clearing history discards Bloom audio measured before the clear",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);f.clear();f.advance(1000);f.api.stop();assert.equal(f.deliveries.reduce((sum,c)=>sum+Number(c.msPlayed),0),1000);}finally{f.destroy();}
});

test("Bloom commits a zero-time terminal chunk after an earlier periodic delivery",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();f.advance(1000);f.flush();f.api.stop();assert.equal(f.deliveries.length,2);assert.equal(f.deliveries[1].msPlayed,0);assert.equal(f.deliveries[1].finished,true);}finally{f.destroy();}
});

test("closing Bloom restores the original playback only when no newer choice intervened",async()=>{
 const normal=fixture();try{normal.api.play(raw);await tick();normal.api.close();assert.equal(normal.resumed,1);}finally{normal.destroy();}
 const changed=fixture();try{changed.api.play(raw);await tick();changed.newPause();await tick();changed.api.close();assert.equal(changed.resumed,0);}finally{changed.destroy();}
});

test("offline Bloom does not request a song that has no verified saved audio",async()=>{
 const f=fixture({offline:true,saved:{track:musicTrack(raw),blob:new Blob(["broken"],{type:"text/plain"}),sizeBytes:6}});try{f.api.play(raw);await tick();assert.equal(f.requests.length,0);assert.equal(f.media.src,"");assert.match(f.api.message,/not saved on this device/);}finally{f.destroy();}
});


test("a late Bloom audio resolution cannot start after the account changes",async()=>{
 const f=fixture({deferResolve:true});try{f.api.play(raw);await tick();assert.equal(f.resolvers.length,1);const old=f.media;await f.account("90000000-0000-4000-8000-000000000002");f.resolve();await tick();assert.equal(old.src,"");assert.equal(old.paused,true);assert.equal(f.deliveries.length,0);f.api.close();assert.equal(f.resumed,0);}finally{f.destroy();}
});

test("a main-player action stops Bloom sound and remains the current playback choice",async()=>{
 const f=fixture();try{f.api.play(raw);await tick();const old=f.media;await f.startMain();assert.equal(old.src,"");assert.equal(old.paused,true);f.api.close();assert.equal(f.resumed,1);}finally{f.destroy();}
});

test("verified saved Bloom audio plays offline without contacting a provider",async()=>{
 const blob=new Blob(["complete audio"],{type:"audio/mpeg"}),f=fixture({offline:true,saved:{track:musicTrack(raw),blob,sha256:"a".repeat(64),sizeBytes:blob.size,savedAt:Date.now(),requested:true}});try{f.api.play(raw);await tick();assert.equal(f.requests.length,0);assert.match(f.media.src,/^blob:/);assert.equal(f.media.paused,false);}finally{f.destroy();}
});


test("an explicit chapter play can sound while automatic playback remains paused",async()=>{
 const f=fixture();try{f.api.pause();f.api.play(raw);await tick();assert.equal(f.media.paused,true);f.api.play(raw,true);await tick();assert.equal(f.media.paused,false);f.advance(1000);f.api.stop();assert.equal(f.deliveries.reduce((sum,chunk)=>sum+Number(chunk.msPlayed),0),1000);}finally{f.destroy();}
});
