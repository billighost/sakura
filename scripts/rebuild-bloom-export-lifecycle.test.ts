import assert from "node:assert/strict";
import {test} from "node:test";
import {bloomExportDataUrl,bloomExportFrame,bloomExportImageReady,bloomExportOwner,bloomExportPng,waitForBloomExport} from "../src/rebuild/bloom/exportLifecycle";
import {exportBloomCard} from "../src/rebuild/bloom/export";
import type {BloomRecap} from "../src/rebuild/bloom/uiTypes";

const pending=()=>new Promise<never>(()=>{});
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

test("a stalled resource cancels promptly and its later rejection cannot revive the export",async()=>{
 const controller=new AbortController();let reject!:(reason:unknown)=>void,stopped=0;
 const task=waitForBloomExport(()=>new Promise<void>((_,no)=>{reject=no;}),{signal:controller.signal,stop:()=>stopped++});
 controller.abort();await assert.rejects(task,{name:"AbortError"});assert.equal(stopped,1);
 reject(new Error("late browser failure"));await tick();assert.equal(stopped,1);
});

test("finite resource deadlines reject without exporting incomplete content and permit retry",async()=>{
 let stopped=0;
 await assert.rejects(waitForBloomExport(pending,{timeoutMs:5,message:"font deadline",stop:()=>stopped++}),/font deadline/);
 assert.equal(stopped,1);assert.equal(await waitForBloomExport(()=>Promise.resolve("complete")),"complete");
});

test("closing an export stops sibling waits without aborting another export's parent",async()=>{
 const parent=new AbortController(),first=bloomExportOwner(parent.signal),second=bloomExportOwner(parent.signal);
 const firstTask=waitForBloomExport(pending,{signal:first.signal});
 first.release();await assert.rejects(firstTask,{name:"AbortError"});assert.equal(parent.signal.aborted,false);assert.equal(second.signal.aborted,false);
 const secondTask=waitForBloomExport(pending,{signal:second.signal});parent.abort();await assert.rejects(secondTask,{name:"AbortError"});second.release();
});

test("an already-cancelled export never starts browser resource work",async()=>{
 const controller=new AbortController();controller.abort();let started=0;
 await assert.rejects(waitForBloomExport(()=>{started++;return Promise.resolve();},{signal:controller.signal}),{name:"AbortError"});assert.equal(started,0);
});

test("an export waiting for a background-tab frame cancels its scheduled callback",async()=>{
 const request=globalThis.requestAnimationFrame,cancel=globalThis.cancelAnimationFrame,controller=new AbortController();let cancelled=0;
 globalThis.requestAnimationFrame=()=>17;globalThis.cancelAnimationFrame=id=>{assert.equal(id,17);cancelled++;};
 try{const task=bloomExportFrame(controller.signal);controller.abort();await assert.rejects(task,{name:"AbortError"});assert.equal(cancelled,1);}
 finally{globalThis.requestAnimationFrame=request;globalThis.cancelAnimationFrame=cancel;}
});

test("cancelled and timed-out FileReaders abort and detach their handlers",async()=>{
 const original=globalThis.FileReader,instances:Reader[]=[];
 class Reader {
  result:string|null=null;error:DOMException|null=null;aborts=0;
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;onabort:(()=>void)|null=null;
  constructor(){instances.push(this);}readAsDataURL(){}abort(){this.aborts++;this.onabort?.();}
 }
 globalThis.FileReader=Reader as unknown as typeof FileReader;
 try{
  const controller=new AbortController(),task=bloomExportDataUrl(new Blob(["artwork"]),controller.signal);
  controller.abort();await assert.rejects(task,{name:"AbortError"});assert.equal(instances[0].aborts,1);assert.equal(instances[0].onload,null);assert.equal(instances[0].onerror,null);assert.equal(instances[0].onabort,null);
  await assert.rejects(bloomExportDataUrl(new Blob(["artwork"]),undefined,5),/taking too long/);assert.equal(instances[1].aborts,1);assert.equal(instances[1].onload,null);
  const retry=bloomExportDataUrl(new Blob(["artwork"]));instances[2].result="data:image/png;base64,cGl4ZWxz";instances[2].onload!();assert.equal(await retry,instances[2].result);assert.equal(instances[2].onload,null);
 }finally{globalThis.FileReader=original;}
});

test("stalled image decoding releases its source on abort and deadline",async()=>{
 const controller=new AbortController();let removals=0;
 const image={decode:pending,removeAttribute:(name:string)=>{assert.equal(name,"src");removals++;}} as unknown as HTMLImageElement;
 const task=bloomExportImageReady(image,controller.signal);controller.abort();await assert.rejects(task,{name:"AbortError"});assert.equal(removals,1);
 await assert.rejects(bloomExportImageReady(image,undefined,5),/could not finish decoding/);assert.equal(removals,2);
 await assert.rejects(bloomExportImageReady({decode:()=>Promise.reject(new Error("bad image"))} as unknown as HTMLImageElement),/bad image/);
 await bloomExportImageReady({decode:()=>Promise.reject(new Error("explicit decode declined")),complete:true,naturalWidth:400} as unknown as HTMLImageElement);
});

test("cancellation during PNG encoding ignores a late browser callback",async()=>{
 const controller=new AbortController();let encoded!:BlobCallback;
 const canvas={toBlob:(callback:BlobCallback)=>{encoded=callback;}} as unknown as HTMLCanvasElement;
 const task=bloomExportPng(canvas,controller.signal);controller.abort();await assert.rejects(task,{name:"AbortError"});encoded(new Blob(["late PNG"]));await tick();
});

test("legacy poster cancellation during fonts releases the real export canvas",async()=>{
 const original=globalThis.document,controller=new AbortController(),canvas={width:0,height:0,getContext:()=>({})};
 globalThis.document={fonts:{ready:pending()},createElement:(name:string)=>{assert.equal(name,"canvas");return canvas;}} as unknown as Document;
 try{
  const task=exportBloomCard({} as BloomRecap,"herbarium","light",false,undefined,5,controller.signal);
  await tick();assert.equal(canvas.width,1080);assert.equal(canvas.height,1920);
  controller.abort();await assert.rejects(task,{name:"AbortError"});assert.equal(canvas.width,0);assert.equal(canvas.height,0);
 }finally{globalThis.document=original;}
});
