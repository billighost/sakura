import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {chromium} from "@playwright/test";

const base=process.env.SAKURA_TEST_URL||"http://127.0.0.1:3117";
const report=process.env.SAKURA_OFFLINE_STORAGE_REPORT||".local/audit-offline-storage-browser.json";
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:"block"});const page=await context.newPage();
 await page.route("**/*",route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 await page.goto(base+"/about",{waitUntil:"domcontentloaded"});
 const result=await page.evaluate(async()=>{
  const name="sakura-performance-diagnostic-"+crypto.randomUUID(),open=indexedDB.open(name,1);
  open.onupgradeneeded=()=>{for(const store of ["shared","audio","metadata"])open.result.createObjectStore(store);};
  const database=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  const completed=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
  const samples=[];
  try{
   const initial=database.transaction(["shared","metadata"],"readwrite"),done=completed(initial);
   for(const store of ["shared","metadata"])initial.objectStore(store).put({accountId:"a",recordingId:"one",sizeBytes:1024*1024},"metadata");await done;
   for(const chunkBytes of [64*1024,256*1024])for(let trial=0;trial<20;trial++)for(const separate of trial%2?[true,false]:[false,true]){
    const store=separate?"audio":"shared",writer=database.transaction(store,"readwrite"),written=completed(writer),blob=new Blob([new Uint8Array(chunkBytes)],{type:"audio/mpeg"});
    for(let index=0;index<4;index++)writer.objectStore(store).put(blob,"chunk:"+index);
    const started=performance.now(),reader=database.transaction(separate?"metadata":"shared","readonly"),readDone=completed(reader),request=reader.objectStore(separate?"metadata":"shared").get("metadata");
    const value=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const readMs=performance.now()-started;await Promise.all([written,readDone]);samples.push({chunkBytes,separate,readMs,totalMs:performance.now()-started,matched:value?.recordingId==="one"});
   }
   const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
   const summaries=[];for(const chunkBytes of [64*1024,256*1024])for(const separate of [false,true]){const values=samples.filter(value=>value.chunkBytes===chunkBytes&&value.separate===separate);summaries.push({chunkBytes,scope:separate?"separate-store experiment":"current shared-store scope",samples:values.length,readP50Ms:percentile(values.map(value=>value.readMs),.5),readP95Ms:percentile(values.map(value=>value.readMs),.95),totalP50Ms:percentile(values.map(value=>value.totalMs),.5)});}
   return {device:navigator.userAgent,samples,summaries};
  }finally{database.close();if(!name.startsWith("sakura-performance-diagnostic-"))throw new Error("Unexpected diagnostic database name.");const removal=indexedDB.deleteDatabase(name);await new Promise((resolve,reject)=>{removal.onsuccess=resolve;removal.onerror=()=>reject(removal.error);removal.onblocked=()=>reject(new Error("Diagnostic database still open."));});}
 });
 assert.equal(result.samples.length,80);assert.ok(result.samples.every(value=>value.matched));
 const output={recordedAt:new Date().toISOString(),base,measurement:"Native IndexedDB laboratory contention experiment with four chunk puts and a metadata read; disposable database only. This is not a production percentile or a storage-migration approval.",...result};
 await mkdir(dirname(report),{recursive:true});await writeFile(report,JSON.stringify(output,null,2)+"\n");console.log(JSON.stringify({report,summaries:result.summaries}));
 await context.close();
}finally{await browser.close();}
