/** Synthetic real-browser cache proof; requires a running Next development server. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=baseExpect.configure({timeout:30000}),base=process.env.SAKURA_TEST_URL||'http://localhost:3023';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const fixture='src/app/cache-check',pageFile=fixture+'/page.tsx';
assert.equal(await fs.stat(pageFile).then(()=>true,()=>false),false,'Do not overwrite an existing route');
await fs.mkdir(fixture,{recursive:true});await fs.copyFile('scripts/fixtures/resource-cache-room.tsx',pageFile);
await fs.mkdir('.local/resource-cache',{recursive:true});
const token=await encode({token:{id:'94090000-0000-4000-8000-000000000401',name:'Cache fixture'},secret,salt:'authjs.session-token'});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({serviceWorkers:'block'});
const page=await context.newPage(),counts={lyrics:0,readings:0,resources:0,blocked:0},errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
let blockProvider=false;
const lines=[{text:'君の声',start:0,end:20},{text:'風に乗せて',start:20,end:40}];
await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
await context.route('**/api/v2/**',async route=>{
 const url=new URL(route.request().url());
 if(blockProvider){counts.blocked++;return route.abort('internetdisconnected');}
 if(url.pathname==='/api/v2/lyrics'){counts.lyrics++;return route.fulfill({json:{lines,timing:'plain',provider:'cache fixture',providerTrackId:401,schemaVersion:'verified-lyrics-v3'}});}
 if(url.pathname==='/api/v2/readings'){counts.readings++;const {language,lines:source}=route.request().postDataJSON(),engine=language==='ja'?'ja-ipadic-hepburn-v1':`multilingual-reading-v1:${language}`;return route.fulfill({json:{engine,lines:source.map((line,index)=>({...line,romanized:language==='ja'?['kimi no koe','kaze ni nosete'][index]:['jūn de shēng','fēng'][index],readingEngine:engine,readingReviewNeeded:false}))}});}
 counts.resources++;return route.fulfill({json:{saved:true,path:url.pathname}});
});
async function probe(){try{return await page.evaluate(()=>({data:window.cacheProbe?.data,secondary:window.cacheProbe?.secondary,loading:window.cacheProbe?.loading,error:window.cacheProbe?.error}));}catch(error){if(/Execution context was destroyed|Cannot find context/.test(error.message))return {data:null,secondary:null,loading:true,error:null};throw error;}}
try{
 await page.goto(base+'/cache-check',{waitUntil:'domcontentloaded',timeout:90000});
 await expect.poll(async()=>(await probe()).data?.timing).toBe('plain');assert.equal(counts.lyrics,1);checks.push('Two lyric views join one provider request.');
 await page.evaluate(()=>window.cacheProbe.read('ja'));await expect(page.locator('[data-cache-readings]')).toHaveText('kimi no koe / kaze ni nosete');
 await page.evaluate(async()=>{await window.cacheProbe.choose('zh');await window.cacheProbe.read('zh');});await expect(page.locator('[data-cache-readings]')).toHaveText('jūn de shēng / fēng');
 await page.evaluate(async()=>{await window.cacheProbe.choose('ja');await window.cacheProbe.read('ja');});assert.equal(counts.readings,2);checks.push('Changing reading languages reuses each completed pronunciation guide.');
 const evidence={engine:'whisper-small-en-v1',audioSha256:'a'.repeat(64),confidence:.98,elapsedMs:1000,sourceContentKey:createHash('sha256').update(JSON.stringify(lines.map(line=>line.text))).digest('hex')};
 await page.evaluate(({evidence,lines})=>window.cacheProbe.sync(lines,evidence),{evidence,lines:[{text:'君の声',start:2,end:12},{text:'風に乗せて',start:22,end:35}]});
 await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');assert.equal(counts.readings,2);assert.equal((await probe()).secondary.timing,'synced');checks.push('Verified auto-sync changes timing in every subscriber while keeping readings.');
 await page.evaluate(async()=>{
  await window.cacheProbe.load('cache-account','/api/v2/artists/fixture?b=2&a=1');
  await window.cacheProbe.load('cache-account','/api/v2/artists/fixture?a=1&b=2');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('lyrics','readwrite'),store=tx.objectStore('lyrics'),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.update({...cursor.value,savedAt:Date.now()-30*86400000});cursor.continue();}};for(let index=0;index<150;index++)store.put({key:'offline-library-'+index,savedAt:Date.now(),data:window.cacheProbe.data});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 });
 assert.equal(counts.resources,1);checks.push('Equivalent artist query paths share one persisted resource identity.');
 blockProvider=true;await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');await expect(page.locator('[data-cache-readings]')).toHaveText('kimi no koe / kaze ni nosete');
 await page.evaluate(async()=>{await window.cacheProbe.choose('zh');await window.cacheProbe.read('zh');});await expect(page.locator('[data-cache-readings]')).toHaveText('jūn de shēng / fēng');
 await page.evaluate(()=>window.cacheProbe.load('cache-account','/api/v2/artists/fixture?b=2&a=1'));
 assert.equal(await page.evaluate(()=>window.cacheProbe.snapshot('cache-account','/api/v2/artists/fixture?a=1&b=2').data.saved),true);
 assert.equal(counts.blocked,0);assert.equal(counts.lyrics,1);assert.equal(counts.readings,2);checks.push('Cold reload with providers unavailable restores month-old lyrics, auto-sync evidence, both reading languages and artist data with zero requests.');
 const count=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);});const total=await new Promise(resolve=>{const request=db.transaction('lyrics').objectStore('lyrics').count();request.onsuccess=()=>resolve(request.result);});db.close();return total;});assert.ok(count>=151);checks.push('Saving new pronunciation data retains all 150 other offline lyric entries.');
 blockProvider=false;await page.evaluate(()=>window.cacheProbe.change());await expect.poll(()=>counts.lyrics).toBe(2);await expect.poll(async()=>(await probe()).loading).toBe(false);
 await page.evaluate(()=>window.cacheProbe.change());await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');assert.equal(counts.lyrics,2);
 await page.evaluate(()=>window.cacheProbe.retry());await expect.poll(()=>counts.lyrics).toBe(3);await expect.poll(async()=>(await probe()).data?.timing).toBe('plain');
 await page.evaluate(()=>window.cacheProbe.change());await expect.poll(async()=>(await probe()).loading).toBe(false);assert.equal(counts.lyrics,3);checks.push('Explicit retry refreshes one song and never becomes a persistent refresh flag for unrelated cached recordings.');
 assert.deepEqual(errors,[]);await page.screenshot({path:'.local/resource-cache/verified.png'});
 const report={checkedAt:new Date().toISOString(),counts,checks,errors};await fs.writeFile('.local/resource-cache/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:'.local/resource-cache/failure.png'}).catch(()=>{});console.error(JSON.stringify({counts,checks,errors,probe:await probe().catch(()=>null)}));throw error;}
finally{await context.close();await browser.close();await fs.unlink(pageFile);await fs.rmdir(fixture).catch(()=>{});}
