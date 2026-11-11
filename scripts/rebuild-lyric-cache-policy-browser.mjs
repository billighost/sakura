/** Plain/missing weekly update checks and permanent synced/offline lyric retention. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';
const expect=baseExpect.configure({timeout:30000}),base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret);
const directory='src/app/lyrics-policy-check',file=directory+'/page.tsx';assert.equal(await fs.stat(file).then(()=>true,()=>false),false);
await fs.mkdir(directory,{recursive:true});await fs.copyFile('scripts/fixtures/resource-cache-room.tsx',file);await fs.mkdir('.local/lyric-cache-policy',{recursive:true});
const token=await encode({token:{id:'94090000-0000-4000-8000-000000000401',name:'Cache fixture'},secret,salt:'authjs.session-token'});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
await context.addInitScript(()=>{if(localStorage.getItem('lyrics-policy-offline')==='1')Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});
const counts={plain:0,missing:0,readings:0,blocked:0},queries=[],checks=[],errors=[];let block=false,fail=false,synced=false,updated=false;
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/api/v2/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/v2/readings'){counts.readings++;const input=route.request().postDataJSON();return route.fulfill({json:{engine:'ja-ipadic-hepburn-v1',lines:input.lines.map(line=>({...line,romanized:'saved guide',readingEngine:'ja-ipadic-hepburn-v1'}))}});}
 if(url.pathname!=='/api/v2/lyrics')return route.fulfill({json:{}});
 if(block){counts.blocked++;return route.abort('internetdisconnected');}
 const second=url.searchParams.get('title')==='Second cache fixture';queries.push({second,refresh:url.searchParams.get('refresh')});
 counts[second?'missing':'plain']++;
 if(second)return route.fulfill({status:404,json:{status:'missing',reason:'no-lyrics'}});
 if(fail)return route.fulfill({status:503,json:{error:'Unavailable'}});
 return route.fulfill({json:{schemaVersion:'verified-lyrics-v3',provider:'weekly fixture',providerTrackId:401,timing:synced?'synced':'plain',lines:[{text:updated?'更新された歌詞':'君の声',start:0,end:40}]}});
});
async function probe(){try{return await page.evaluate(()=>({data:window.cacheProbe?.data,loading:window.cacheProbe?.loading,error:window.cacheProbe?.error}));}catch(error){if(/Execution context was destroyed|Cannot find context/.test(error.message))return {data:null,loading:true,error:null};throw error;}}
async function reload(){await page.goto(base+'/lyrics-policy-check',{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator('[data-cache-state]')).toBeVisible();}
async function age(days){await page.evaluate(async days=>{const db=await new Promise(resolve=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);});await new Promise(resolve=>{const tx=db.transaction('lyrics','readwrite'),request=tx.objectStore('lyrics').openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.update({...cursor.value,checkedAt:Date.now()-days*86400000});cursor.continue();}};tx.oncomplete=resolve;});db.close();},days);}
try{
 await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('plain');assert.equal(counts.plain,1);
 await page.evaluate(()=>window.cacheProbe.read('ja'));await expect(page.locator('[data-cache-readings]')).toHaveText('saved guide');await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('plain');assert.equal(counts.plain,1);assert.equal(counts.readings,1);checks.push('Fresh plain lyrics and their reading guide are reused across views and reloads.');
 await age(8);updated=true;await reload();await expect.poll(()=>counts.plain).toBe(2);await expect.poll(async()=>(await probe()).data?.lines[0].text).toBe('更新された歌詞');assert.equal(queries.at(-1).refresh,'1');checks.push('After seven days, both lyric views share one update request that bypasses the server cache.');
 await page.evaluate(()=>window.cacheProbe.read('ja'));await expect(page.locator('[data-cache-readings]')).toHaveText('saved guide');await age(180);fail=true;await reload();await expect.poll(()=>counts.plain).toBe(3);await expect.poll(async()=>(await probe()).data?.lines[0].text).toBe('更新された歌詞');
 await page.evaluate(()=>localStorage.setItem('lyrics-policy-offline','1'));block=true;await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('plain');await expect(page.locator('[data-cache-readings]')).toHaveText('saved guide');assert.equal(counts.blocked,0);checks.push('A failed refresh preserves the last plain lyric and reading guide; six-month-old copies reopen offline without a request.');
 block=false;fail=false;synced=true;await page.evaluate(()=>{localStorage.removeItem('lyrics-policy-offline');});await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');const completed=counts.plain;await age(400);await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');assert.equal(counts.plain,completed);checks.push('Synced lyrics remain permanent after more than a year.');
 await page.evaluate(()=>window.cacheProbe.change());await expect.poll(async()=>(await probe()).error).toBeTruthy();assert.equal(counts.missing,1);
 await page.evaluate(()=>window.cacheProbe.change());await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');await page.evaluate(()=>window.cacheProbe.change());await expect.poll(async()=>(await probe()).error).toBeTruthy();assert.equal(counts.missing,1);checks.push('A completed no-lyrics lookup is reused without repeated provider calls.');
 await age(8);await reload();await expect.poll(async()=>(await probe()).data?.timing).toBe('synced');await page.evaluate(()=>window.cacheProbe.change());await expect.poll(()=>counts.missing).toBe(2);await expect.poll(async()=>(await probe()).error).toBeTruthy();assert.equal(queries.at(-1).refresh,'1');
 await page.evaluate(()=>window.cacheProbe.retry());await expect.poll(()=>counts.missing).toBe(3);assert.equal(queries.at(-1).refresh,'1');checks.push('No-lyrics results check again weekly, and explicit retry always checks immediately.');
 assert.deepEqual(errors,[]);const report={checkedAt:new Date().toISOString(),counts,checks,errors};await fs.writeFile('.local/lyric-cache-policy/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:'.local/lyric-cache-policy/failure.png'}).catch(()=>{});console.error(JSON.stringify({counts,queries,checks,errors,probe:await probe()}));throw error;}
finally{await context.close();await browser.close();await fs.unlink(file);await fs.rmdir(directory).catch(()=>{});}
