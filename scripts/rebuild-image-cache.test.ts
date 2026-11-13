import assert from "node:assert/strict";
import {test} from "node:test";
import {retainArtwork,artworkMemoryStats,MAX_RETAINED_ARTWORK_BYTES} from "../src/rebuild/player/imageCache";

let sequence=0;
const source=()=>`https://artwork-fixture.invalid/${++sequence}.webp`;

function fixture(){
 const original=Object.getOwnPropertyDescriptor(globalThis,"Image"),images:FakeImage[]=[];
 class FakeImage {
  src="";decoding="";fetchPriority="";decodeCalls=0;cancelled=0;naturalWidth=320;naturalHeight=320;
  decodingWork:()=>Promise<void>=()=>Promise.resolve();
  handlers=new Map<string,Set<EventListener>>();
  constructor(){images.push(this);}
  addEventListener(name:string,handler:EventListener){const group=this.handlers.get(name)||new Set<EventListener>();group.add(handler);this.handlers.set(name,group);}
  removeEventListener(name:string,handler:EventListener){this.handlers.get(name)?.delete(handler);}
  removeAttribute(name:string){if(name==="src"){this.src="";this.cancelled++;}}
  decode(){this.decodeCalls++;return this.decodingWork();}
  emit(name:string){for(const handler of [...this.handlers.get(name)||[]])handler(new Event(name));}
  listeners(){return [...this.handlers.values()].reduce((count,group)=>count+group.size,0);}
 }
 Object.defineProperty(globalThis,"Image",{configurable:true,writable:true,value:FakeImage});
 return {images,restore(){if(original)Object.defineProperty(globalThis,"Image",original);else Reflect.deleteProperty(globalThis,"Image");}};
}

test("a stalled image times out, releases its handlers and retries with a fresh image",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const f=fixture();try{
  const url=source(),pending=retainArtwork(url,false,{timeoutMs:25}),failure=assert.rejects(pending,{name:"TimeoutError"});
  t.mock.timers.tick(25);await failure;
  assert.equal(f.images[0].listeners(),0);assert.equal(f.images[0].src,"");assert.equal(f.images[0].cancelled,1);
  const retry=retainArtwork(url);assert.equal(f.images.length,2);f.images[1].emit("load");await retry;
  await retainArtwork(url,true);assert.equal(f.images.length,2);assert.equal(f.images[1].fetchPriority,"high");
 }finally{f.restore();}
});

test("the deadline also bounds a decode that never completes",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const f=fixture();try{
  const pending=retainArtwork(source(),false,{timeoutMs:30}),failure=assert.rejects(pending,{name:"TimeoutError"});
  f.images[0].decodingWork=()=>new Promise<void>(()=>{});f.images[0].emit("load");await Promise.resolve();
  assert.equal(f.images[0].decodeCalls,1);t.mock.timers.tick(30);await failure;
  assert.equal(f.images[0].listeners(),0);assert.equal(f.images[0].src,"");
 }finally{f.restore();}
});

test("legacy callers share a finite load and decode deadline",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const f=fixture();try{
  const url=source(),a=retainArtwork(url),b=retainArtwork(url);
  const failures=[assert.rejects(a,{name:"TimeoutError"}),assert.rejects(b,{name:"TimeoutError"})];
  assert.equal(f.images.length,1);t.mock.timers.tick(15000);await Promise.all(failures);
  assert.equal(f.images[0].listeners(),0);assert.equal(f.images[0].cancelled,1);
  const retry=retainArtwork(url);f.images[1].emit("load");await retry;
 }finally{f.restore();}
});

test("aborting the sole subscriber cancels pending work and permits an immediate retry",async()=>{
 const f=fixture();try{
  const url=source(),controller=new AbortController(),pending=retainArtwork(url,false,{signal:controller.signal});
  const failure=assert.rejects(pending,{name:"AbortError"});controller.abort();await failure;
  assert.equal(f.images[0].listeners(),0);assert.equal(f.images[0].src,"");
  const retry=retainArtwork(url);assert.equal(f.images.length,2);f.images[1].emit("load");await retry;
 }finally{f.restore();}
});

test("one subscriber aborting preserves an ordinary caller's shared image",async()=>{
 const f=fixture();try{
  const url=source(),controller=new AbortController(),departing=retainArtwork(url,false,{signal:controller.signal}),ordinary=retainArtwork(url);
  const failure=assert.rejects(departing,{name:"AbortError"});controller.abort();await failure;
  assert.equal(f.images.length,1);assert.equal(f.images[0].src,url);assert.equal(f.images[0].cancelled,0);
  f.images[0].emit("load");await ordinary;await retainArtwork(url);assert.equal(f.images.length,1);
 }finally{f.restore();}
});

test("a short consumer deadline does not cancel a subscriber with time remaining",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const f=fixture();try{
  const url=source(),short=retainArtwork(url,false,{timeoutMs:20}),patient=retainArtwork(url,false,{timeoutMs:100});
  const failure=assert.rejects(short,{name:"TimeoutError"});t.mock.timers.tick(20);await failure;
  assert.equal(f.images[0].src,url);assert.equal(f.images[0].cancelled,0);f.images[0].emit("load");await patient;
 }finally{f.restore();}
});

test("a late error from an LRU-evicted pending image cannot remove its newer retry",async()=>{
 const f=fixture();try{
  const url=source(),old=retainArtwork(url),failure=assert.rejects(old,/could not be decoded/),oldImage=f.images[0];
  for(let index=0;index<72;index++){const saved=retainArtwork(source());f.images.at(-1)!.emit("load");await saved;}
  const retry=retainArtwork(url);assert.equal(f.images.length,74);const current=f.images.at(-1)!;
  oldImage.emit("error");await failure;
  assert.equal(oldImage.listeners(),0);current.emit("load");await retry;
  await retainArtwork(url);assert.equal(f.images.length,74);
 }finally{f.restore();}
});

test("loaded artwork stays cached when the browser declines an explicit decode",async()=>{
 const f=fixture();try{
  const url=source(),pending=retainArtwork(url);f.images[0].decodingWork=()=>Promise.reject(new Error("Decode declined"));
  f.images[0].emit("load");await pending;await retainArtwork(url);assert.equal(f.images.length,1);
 }finally{f.restore();}
});

test("a pre-aborted caller does not create an image request",async()=>{
 const f=fixture();try{
  const controller=new AbortController();controller.abort();await assert.rejects(retainArtwork(source(),false,{signal:controller.signal}),{name:"AbortError"});
  assert.equal(f.images.length,0);
 }finally{f.restore();}
});

test("decoded artwork evicts by bytes and releases hidden images instead of retaining twelve huge covers",async()=>{
 const f=fixture();try{
  for(let index=0;index<16;index++){
   const pending=retainArtwork(source()),image=f.images.at(-1)!;image.naturalWidth=image.naturalHeight=2048;image.emit("load");await pending;
   assert.ok(artworkMemoryStats().decodedBytes<=MAX_RETAINED_ARTWORK_BYTES);
  }
  assert.ok(artworkMemoryStats().entries<=3);
  assert.ok(f.images.slice(0,-3).every(image=>image.src===""&&image.listeners()===0));
  const url=source(),oversized=retainArtwork(url),image=f.images.at(-1)!;image.naturalWidth=image.naturalHeight=4096;image.emit("load");await oversized;
  assert.equal(image.src,"");assert.ok(artworkMemoryStats().decodedBytes<=MAX_RETAINED_ARTWORK_BYTES);
  const retry=retainArtwork(url),next=f.images.at(-1)!;assert.notEqual(next,image);next.emit("load");await retry;
 }finally{f.restore();}
});
