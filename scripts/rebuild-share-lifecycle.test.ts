import assert from "node:assert/strict";
import {test} from "node:test";
import {renderShareCard, type ShareCardInput} from "../src/rebuild/player/shareRender";

const input: ShareCardInput={track:{id:"fixture",title:"Share lifecycle fixture",artists:["Synthetic artist"],coverUrl:null,versionLabel:"Original recording",reference:{provider:"deezer",id:"501"}} as ShareCardInput["track"],lines:[],colorMode:"light",layout:"square"};
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

function installDocument(fonts: PromiseLike<unknown>=Promise.resolve()) {
 const originalDocument=globalThis.document,originalStyle=globalThis.getComputedStyle;
 let encoded: BlobCallback | undefined;
 const context=new Proxy({measureText:()=>({width:100})},{get:(target,key)=>key in target?target[key as keyof typeof target]:()=>{}});
 const canvas={width:0,height:0,getContext:()=>context,toBlob:(callback:BlobCallback)=>{encoded=callback;}};
 globalThis.document={fonts:{ready:fonts},createElement:()=>canvas} as unknown as Document;
 globalThis.getComputedStyle=()=>({getPropertyValue:()=>"Georgia"}) as unknown as CSSStyleDeclaration;
 return {canvas,encoded:()=>encoded,restore:()=>{globalThis.document=originalDocument;globalThis.getComputedStyle=originalStyle;}};
}

test("closing a card during native PNG encoding releases its real renderer canvas before a late callback",async()=>{
 const fixture=installDocument(),controller=new AbortController();
 try{
  const result=renderShareCard(input,controller.signal),rejected=assert.rejects(result,{name:"AbortError"});
  for(let index=0;index<100&&!fixture.encoded();index++)await tick();
  assert.ok(fixture.encoded());assert.equal(fixture.canvas.width,1080);
  controller.abort();await rejected;assert.equal(fixture.canvas.width,0);assert.equal(fixture.canvas.height,0);
  fixture.encoded()!(new Blob(["late PNG"],{type:"image/png"}));await tick();assert.equal(fixture.canvas.width,0);
 }finally{fixture.restore();}
});

test("font preparation cancels before a canvas is created and observes late failure",async()=>{
 let fail!: (error:unknown)=>void;
 const fixture=installDocument(new Promise((_,reject)=>{fail=reject;})),controller=new AbortController();
 try{
  const result=renderShareCard(input,controller.signal),rejected=assert.rejects(result,{name:"AbortError"});
  controller.abort();await rejected;assert.equal(fixture.canvas.width,0);
  fail(new Error("late font failure"));await tick();
 }finally{fixture.restore();}
});

test("a stalled font has a finite deadline and a fresh card can retry",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 const fixture=installDocument(new Promise(()=>{}));
 try{
  const result=renderShareCard(input),rejected=assert.rejects(result,/fonts are taking too long/);
  t.mock.timers.tick(15_000);await rejected;assert.equal(fixture.canvas.width,0);
 }finally{fixture.restore();t.mock.timers.reset();}
 const retry=installDocument();
 try{
  const result=renderShareCard(input);
  for(let index=0;index<100&&!retry.encoded();index++)await tick();
  assert.ok(retry.encoded());retry.encoded()!(new Blob(["fresh PNG"],{type:"image/png"}));
  const card=await result;assert.equal(card.canvas.width,1080);assert.equal(card.file.type,"image/png");assert.equal(card.blob.size,9);
 }finally{retry.restore();}
});
