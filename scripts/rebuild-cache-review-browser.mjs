import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as expectBase} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import {fixtureReadingEngine} from './fixtures/reading-engine.mjs';
const base=process.env.SAKURA_TEST_URL||'http://localhost:3012',expect=expectBase.configure({timeout:30000});
let fixture=await fs.readFile('scripts/fixtures/resource-cache-room.tsx','utf8');fixture=fixture.replace('retry:()=>void;','publish:(lyrics:PlayerLyrics)=>Promise<void>;retry:()=>void;').replace('retry:first.retry,','publish:first.applyPublishedLyrics,retry:first.retry,');
fixture+='\nimport {createRoot} from "react-dom/client"; createRoot(document.getElementById("cache-root")!).render(<ResourceCacheRoom/>);';
const bundle=(await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},alias:{'@':path.resolve('src')},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}})).outputFiles[0].text;
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
const oldLines=[{text:'君の声',start:0,end:40}],published={schemaVersion:'verified-lyrics-v3',provider:'published review fixture',providerTrackId:999,timing:'plain',lines:[{text:'New published words',start:0,end:40}],hasJapanese:false};
async function room(timing='plain',malformed=false){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let calls=0,wrong=malformed,blocked=false;
 await context.route('**/cache-review',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="cache-root"></div><script src="/cache-review-bundle.js"></script></body></html>'}));await context.route('**/cache-review-bundle.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await context.addInitScript(()=>{
  if(localStorage.getItem('review-offline')==='1')Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
  if(localStorage.getItem('review-delay-idb-get')==='1'){
   const get=IDBObjectStore.prototype.get;
   IDBObjectStore.prototype.get=function(...args){
    const request=get.apply(this,args);
    if(this.name!=='lyrics')return request;
    return new Proxy(request,{
     get:(target,property)=>Reflect.get(target,property,target),
     set(target,property,value){
      if(property==='onsuccess'){
       target.onsuccess=event=>{(window.reviewHeldReads||=[]).push(()=>value.call(target,event));};
       return true;
      }
      return Reflect.set(target,property,value,target);
     }
    });
   };
  }
 });
 await context.route('**/api/v2/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/v2/readings'){const input=route.request().postDataJSON(),engine=fixtureReadingEngine(input.language);return route.fulfill({json:{engine,lines:input.lines.map(line=>({...line,romanized:'review guide',readingEngine:engine}))}});}if(url.pathname!=='/api/v2/lyrics')return route.fulfill({json:{}});calls++;if(blocked)return route.abort('internetdisconnected');if(wrong)return wrong==='json'?route.fulfill({status:404,json:{error:'Proxy route unavailable'}}):route.fulfill({status:404,contentType:'text/html',body:'<html><h1>Proxy route unavailable</h1></html>'});return route.fulfill({json:{schemaVersion:'verified-lyrics-v3',provider:'review fixture',providerTrackId:1,timing,lines:oldLines}});});
 const load=async()=>{await page.goto(base+'/cache-review',{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator('[data-cache-state]')).toBeVisible();};
 const data=()=>page.evaluate(()=>window.cacheProbe?.data);
 return {context,page,load,data,calls:()=>calls,good:()=>{wrong=false;},block:()=>{blocked=true;}};
}
async function updateRecords(page,mutate){await page.evaluate(async source=>{const mutate=eval('('+source+')'),db=await new Promise(resolve=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);});await new Promise(resolve=>{const tx=db.transaction('lyrics','readwrite'),store=tx.objectStore('lyrics'),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){const value=mutate(cursor.value);if(value.key!==cursor.value.key){cursor.delete();store.put(value);}else cursor.update(value);cursor.continue();}};tx.oncomplete=resolve;});db.close();},mutate.toString());}
try{
 {
  const r=await room();try{await r.load();await expect.poll(async()=>(await r.data())?.timing).toBe('plain');await r.page.evaluate(async()=>{await window.cacheProbe.choose('zh');await window.cacheProbe.read('zh');});await expect.poll(async()=>(await r.data())?.readingLanguage).toBe('zh');await updateRecords(r.page,value=>({...value,checkedAt:Date.now()-8*86400000}));await r.load();await expect.poll(r.calls).toBe(2);await expect.poll(async()=>(await r.data())?.readingLanguage).toBe('zh');results.push({passed:'Weekly refresh preserves an explicitly chosen reading language and cached guide',readingLanguage:(await r.data()).readingLanguage,providerCalls:r.calls()});}finally{await r.context.close();}
 }
 {
  const r=await room('plain',true);try{await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.error)).toBeTruthy();r.good();await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.loading)).toBe(false);await expect.poll(async()=>(await r.data())?.timing).toBe('plain');assert.equal(r.calls(),2);results.push({passed:'Malformed HTML404 is not negative cached',providerCallsAfterRecovery:r.calls()});}finally{await r.context.close();}
 }
 {
  const r=await room('plain','json');try{await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.error)).toBeTruthy();r.good();await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.loading)).toBe(false);await expect.poll(async()=>(await r.data())?.timing).toBe('plain');assert.equal(r.calls(),2);results.push({passed:'An unrelated JSON404 remains retryable and never becomes a weekly no-lyrics result',providerCallsAfterRecovery:r.calls()});}finally{await r.context.close();}
 }
 {
  const r=await room('synced');try{await r.load();await expect.poll(async()=>(await r.data())?.timing).toBe('synced');await updateRecords(r.page,value=>{const key=JSON.parse(value.key);key.splice(1,0,'multilingual-reading-v0');return {...value,key:JSON.stringify(key)};});await r.page.evaluate(()=>localStorage.setItem('review-offline','1'));r.block();await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.loading)).toBe(false);assert.equal((await r.data()).timing,'synced');assert.equal(r.calls(),1);results.push({passed:'A previous reading-engine cache identity migrates offline without losing synced lyrics or fetching again'});}finally{await r.context.close();}
 }
 {
  const r=await room();try{await r.load();await expect.poll(async()=>(await r.data())?.timing).toBe('plain');const evidence={engine:'whisper-small-en-v1',audioSha256:'a'.repeat(64),confidence:.98,sourceContentKey:createHash('sha256').update(JSON.stringify(oldLines.map(line=>line.text))).digest('hex')};
   await r.page.evaluate(({evidence,lines})=>{const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...args)=>digest(...args).then(value=>new Promise(resolve=>{window.reviewReleaseDigest=()=>resolve(value);}));window.reviewSyncDone=false;void window.cacheProbe.sync(lines,evidence).then(()=>window.reviewSyncDone=true).catch(error=>{window.reviewSyncError=error.message;window.reviewSyncDone=true;});},{evidence,lines:[{text:'君の声',start:2,end:35}]});await expect.poll(()=>r.page.evaluate(()=>typeof window.reviewReleaseDigest)).toBe('function');await r.page.evaluate(published=>window.cacheProbe.publish(published),published);await expect.poll(async()=>(await r.data())?.lines[0].text).toBe('New published words');await r.page.evaluate(()=>window.reviewReleaseDigest());await expect.poll(()=>r.page.evaluate(()=>window.reviewSyncDone)).toBe(true);assert.equal((await r.data()).lines[0].text,'New published words');assert.match(await r.page.evaluate(()=>window.reviewSyncError),/lyrics changed/i);results.push({passed:'A late auto-sync result cannot overwrite a newer publication',finalText:(await r.data()).lines[0].text,finalTiming:(await r.data()).timing});
  }finally{await r.context.close();}
 }
 {
  const r=await room('synced');try{
   await r.load();await expect.poll(async()=>(await r.data())?.timing).toBe('synced');
   await r.page.evaluate(()=>localStorage.setItem('review-delay-idb-get','1'));
   await r.load();await expect.poll(()=>r.page.evaluate(()=>window.reviewHeldReads?.length||0)).toBe(2);
   await r.page.evaluate(published=>window.cacheProbe.publish(published),published);
   await expect.poll(async()=>(await r.data())?.lines[0].text).toBe('New published words');
   await r.page.evaluate(()=>{for(const release of window.reviewHeldReads)release();window.reviewHeldReads=[];});
   await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.loading)).toBe(false);
   assert.equal((await r.data()).lines[0].text,'New published words');assert.equal(r.calls(),1);
   await r.page.evaluate(()=>localStorage.removeItem('review-delay-idb-get'));
   await r.load();await expect.poll(async()=>(await r.data())?.lines[0].text).toBe('New published words');
   results.push({passed:'An older delayed IndexedDB read cannot overwrite a newer publication, including after reopening',finalText:(await r.data()).lines[0].text});
  }finally{await r.context.close();}
 }
 {
  const r=await room('synced');try{
   await r.load();await expect.poll(async()=>(await r.data())?.timing).toBe('synced');
   await updateRecords(r.page,value=>{const key=JSON.parse(value.key);key.splice(1,0,'multilingual-reading-v0');return {...value,key:JSON.stringify(key)};});
   await r.page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);});
    await new Promise(resolve=>{
     const tx=db.transaction('lyrics','readwrite'),store=tx.objectStore('lyrics'),request=store.getAll();
     request.onsuccess=()=>{
      const value=request.result[0],key=JSON.parse(value.key);
      key[1]='multilingual-reading-v1';store.put({...value,key:JSON.stringify(key),savedAt:Date.now()+10000,checkedAt:Date.now(),data:{...value.data,timing:'plain',provider:'later plain fixture',readingLanguage:'zh',lines:value.data.lines.map(line=>({...line,romanized:'legacy zh guide',readingEngine:'multilingual-reading-v1:zh'}))}});
      key[1]='multilingual-reading-v2';store.put({...value,key:JSON.stringify(key),savedAt:Date.now()+20000,data:{...value.data,lines:'malformed legacy lines'}});
     };
     tx.oncomplete=resolve;
    });db.close();localStorage.setItem('review-offline','1');
   });
   r.block();await r.load();await expect.poll(()=>r.page.evaluate(()=>window.cacheProbe?.loading)).toBe(false);
   const actual=(await r.data()).timing;
   await fs.writeFile('.local/cache-review-multiple-keys-report.json',JSON.stringify({verifiedAt:new Date().toISOString(),expected:'synced',actual,providerCalls:r.calls()},null,2));
   assert.equal(actual,'synced');assert.equal(r.calls(),1);
   const reading=await r.page.evaluate(async()=>{
    await window.cacheProbe.choose('zh');
    try{await window.cacheProbe.read('zh');return {error:null};}catch(error){return {error:error.message};}
   });
   await fs.writeFile('.local/cache-review-legacy-guides-report.json',JSON.stringify({verifiedAt:new Date().toISOString(),...reading},null,2));
   assert.match(reading.error,/Reconnect once/);assert.equal((await r.data()).lines[0].romanized,undefined);
   await r.page.evaluate(async()=>{
    localStorage.removeItem('review-offline');Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
    await window.cacheProbe.read('zh');
   });
   await expect.poll(async()=>(await r.data())?.lines[0].romanized).toBe('review guide');
   assert.equal((await r.data()).timing,'synced');assert.equal(r.calls(),1);
   await r.page.evaluate(published=>window.cacheProbe.publish(published),published);
   await r.load();await expect.poll(async()=>(await r.data())?.lines[0].text).toBe('New published words');assert.equal(r.calls(),1);
   results.push({passed:'Multiple historical keys preserve synced lyrics over plain or malformed copies; obsolete readings regenerate after reconnecting and a newer deliberate publication stays authoritative'});
  }finally{await r.context.close();}
 }
 await fs.writeFile('.local/cache-review-verified-report.json',JSON.stringify({verifiedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
