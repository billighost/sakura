/** Real story UI with private preparation, delayed commits and explicit gates.
 * All account and product API calls are intercepted; no listener is changed. */
import 'dotenv/config';
import {bloomAudioFixture} from './fixtures/bloom-audio.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';
import {discloseBloomChapter} from '../src/rebuild/bloom/snapshot.ts';
import {discloseBloomListening} from '../src/rebuild/bloom/listening.ts';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3027';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000489',username:'Staging fixture',email:'staging@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const card={id:'80000000-0000-4000-8000-000000000489',recordingId:'80000000-0000-4000-8000-000000000489',title:'A prepared soundtrack',artists:['A familiar voice'],coverUrl:'https://bloom-fixture.invalid/staged-cover.svg',durationMs:180000,reference:{provider:'deezer',id:'489'},references:[{provider:'deezer',id:'489'}]};
const chapters=[
 {id:'listening-time',kind:'time',title:'Your listening time.',prompt:'',stat:{label:'of listening',value:'1 hour',unit:''},relatedRecording:null},
 {id:'top-song',kind:'song-winner',title:'Your leading song.',prompt:'',stat:{label:card.title,value:'30 minutes',unit:''},relatedRecording:null,recordings:[{rank:1,audibleMs:1800000,plays:10,recording:card}]},
 {id:'time-of-day',kind:'pattern',title:'Your favourite light.',prompt:'',stat:{label:'was your leading hour',value:'Evening',unit:''},relatedRecording:null},
];
const listening={timeZone:'Africa/Lagos',audibleMs:3600000,recordingCount:1,activeDays:4,peakHour:20};
const skeleton={id:'monthly-2026-10',period:'monthly',periodStart:'2026-10-01T00:00:00+01:00',periodEnd:'2026-11-01T00:00:00+01:00',publishAt:'2026-11-01T00:00:00+01:00',expiresAt:'2099-11-24T00:00:00+01:00',timeZone:'Africa/Lagos',status:'available',version:3,worldId:'sakura',snapshotCreatedAt:'2026-11-11T07:00:00Z',chapterCount:chapters.length,summary:{audibleMs:3600000,recordingCount:1,playCount:10,activeDays:4}};
const output='.local/bloom-staging';await fs.mkdir(output,{recursive:true});
const report={checkedAt:new Date().toISOString(),scope:'Real Next story; signed synthetic account and immutable saved facts, all API writes intercepted',checks:[],errors:[]};
const browser=await chromium.launch({headless:true});
function gate(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}

async function room(variant){
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 const preparedAudio=bloomAudioFixture([card]);
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 const revealed=new Set(),writes=[],images=[];let completed=false,prepares=0,completions=0;
 const preparedGate=gate(),revealGate=gate(),completeGate=gate();
 if(variant!=='delayed')preparedGate.release();
 if(variant==='retry')revealGate.release();
 const recap=()=>({...skeleton,completed,chapters:chapters.map(chapter=>discloseBloomChapter(chapter,revealed.has(chapter.id))),listening:discloseBloomListening(listening,new Set(chapters.filter(chapter=>revealed.has(chapter.id)).flatMap(chapter=>[chapter.kind,chapter.id])),completed)});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(await preparedAudio(route))return;
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',privateSession:true,reducedMotion:true,bloomPerformance:'1',onboarded:true,openingAnimation:0}});
  if(path==='/api/v2/image'){images.push(url.searchParams.get('url'));return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#7c9186"/><circle cx="285" cy="120" r="66" fill="#e6c49e"/></svg>'});}
  if(path===`/api/v2/bloom/${skeleton.id}`){
   if(request.method()!=='GET'||[...url.searchParams].some(([key,value])=>key!=='prepare'||value!=='1')){report.errors.push(`Unexpected Bloom detail request: ${request.method()} ${url.pathname}${url.search}`);return route.fulfill({status:501,json:{error:'Unexpected synthetic Bloom detail request'}});}
   if(url.searchParams.get('prepare')==='1'){prepares++;await preparedGate.promise;if(variant==='retry'&&prepares===1)return route.fulfill({status:503,json:{error:'Synthetic preparation interruption'}});return route.fulfill({json:{story:recap(),chapters,listening}});}
   return route.fulfill({json:recap()});
  }
  if(path.endsWith('/prepare')){report.errors.push(`Obsolete Bloom preparation request: ${request.method()} ${path}`);return route.fulfill({status:501,json:{error:'Obsolete synthetic Bloom preparation request'}});}
  if(path.endsWith('/reveal')){
   const id=request.postDataJSON().chapterId,index=chapters.findIndex(chapter=>chapter.id===id);writes.push(id);
   assert.ok(index>=0);assert.ok(chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)),'server prerequisites remain sequential');
   if(index===0)await revealGate.promise;
   revealed.add(id);return route.fulfill({json:recap()});
  }
  if(path.endsWith('/complete')){
   completions++;assert.equal(revealed.size,chapters.length,'complete waits for real reveal receipts');
   if(variant==='retry'&&completions===1)return route.fulfill({status:503,json:{error:'Synthetic completion interruption'}});
   await completeGate.promise;completed=true;return route.fulfill({json:recap()});
  }
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:[],schedule:{timeZone:'Africa/Lagos'}}});
  return route.fulfill({json:{items:[],recordings:[],session:null,serverTime:Date.now()}});
 });
 await page.goto(`${base}/bloom/${skeleton.id}`,{waitUntil:'domcontentloaded',timeout:120000});
 const dialog=page.locator('dialog[open]');await expect.poll(()=>prepares).toBe(1);assert.deepEqual(writes,[]);
 if(variant==='delayed')await expect(dialog).toHaveCount(0);
 else if(variant==='retry')await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
 else{await dialog.locator('[data-bloom-action="begin"]').waitFor();await dialog.locator('[data-bloom-action="begin"]').click();}
 return {context,page,dialog,writes,images,preparedGate,revealGate,completeGate,counts:()=>({prepares,completions,completed,confirmed:revealed.size})};
}

try{
 const delayed=await room('delayed');
 await expect.poll(()=>delayed.counts().prepares).toBe(1);
 assert.equal(await delayed.dialog.locator('[aria-current="step"]').count(),0);
 delayed.preparedGate.release();
 await delayed.dialog.locator('[data-bloom-action="begin"]').waitFor();
 await delayed.dialog.locator('[data-bloom-action="begin"]').click();
 await expect(delayed.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: Your listening time.');
 await expect.poll(()=>delayed.writes.length).toBe(1);assert.equal(delayed.counts().confirmed,0);
 await expect(delayed.dialog.locator('nav button').nth(1)).toBeDisabled();
 await delayed.dialog.locator('[data-bloom-action="next"]').evaluate(button=>{button.click();button.click();});
 await expect(delayed.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 2: Your leading song.');
 assert.deepEqual(delayed.writes,['listening-time'],'next paints before the delayed reveal receipt');
 await expect.poll(()=>delayed.images.includes(card.coverUrl)).toBe(true,'future artwork is prepared ahead');
 await delayed.dialog.locator('[data-bloom-action="next"]').click();
 await expect(delayed.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 3: Your favourite light.');
 await delayed.dialog.locator('[data-bloom-action="next"]').click();
 await expect(delayed.dialog.locator('[data-bloom-action="save"]')).toBeVisible();
 assert.equal(delayed.counts().completions,0,'finale renders without waiting for queued commits');
 assert.equal(delayed.counts().completed,false);
 assert.equal(await delayed.dialog.getByText('Opening the next part of your story…',{exact:true}).count(),0);
 const bookmarkKey=`sakura-bloom-scene:${account.id}:${skeleton.id}`;
 assert.equal(JSON.parse(await delayed.page.evaluate(key=>localStorage.getItem(key),bookmarkKey)).index,2,'bookmark remains until completion is confirmed');
 delayed.revealGate.release();await expect.poll(()=>delayed.counts().completions).toBe(1);
 assert.deepEqual(delayed.writes,chapters.map(chapter=>chapter.id));
 await delayed.page.screenshot({path:`output/finale-pending.png`.replace('output',output),animations:'disabled'});
 await delayed.dialog.getByRole('button',{name:'Play the story again',exact:true}).click();
 await delayed.dialog.locator('[data-bloom-action="begin"]').click();
 await expect(delayed.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: Your listening time.');
 delayed.completeGate.release();await expect.poll(()=>delayed.counts().completed).toBe(true);
 await expect(delayed.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: Your listening time.');
 await expect(delayed.dialog.locator('[data-bloom-action="save"]')).toHaveCount(0);
 report.checks.push('Private assets prepare before Enter; staged Next/finale paint during delayed real commits; double Next advances once; all artwork warms; completion cannot rewind replay');
 await delayed.context.close();

 const retry=await room('retry');
 await retry.page.getByRole('button',{name:'Reconnect',exact:true}).click();
 await retry.dialog.locator('[data-bloom-action="begin"]').waitFor();
 if(await retry.dialog.locator('[data-bloom-action="begin"]').count())await retry.dialog.locator('[data-bloom-action="begin"]').click();
 await expect(retry.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: Your listening time.');
 for(let index=1;index<chapters.length;index++){await retry.dialog.locator('[data-bloom-action="next"]').click();await expect(retry.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter ${index+1}: ${chapters[index].title}`);}
 await retry.dialog.locator('[data-bloom-action="next"]').click();await expect(retry.dialog.locator('[data-bloom-action="save"]')).toBeVisible();
 await expect(retry.dialog.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
 assert.equal(retry.counts().completed,false);
 await retry.dialog.getByRole('button',{name:'Reconnect',exact:true}).click();await expect.poll(()=>retry.counts().completions).toBe(2);
 retry.completeGate.release();await expect.poll(()=>retry.counts().completed).toBe(true);
 await expect.poll(()=>retry.page.evaluate(key=>localStorage.getItem(key),bookmarkKey)).toBe(null);
 assert.equal(retry.counts().prepares,2);assert.equal(retry.writes.length,chapters.length);
 report.checks.push('Preparation and completion failures remain actionable and retry successfully; completion bookmark clears only after confirmation');
 await retry.context.close();

 const hidden=await room('hidden');
 await expect(hidden.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: Your listening time.');
 await hidden.dialog.locator('[data-bloom-action="next"]').click();await expect(hidden.dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 2: Your leading song.');
 await hidden.dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();await hidden.page.waitForURL('**/bloom');
 hidden.revealGate.release();await expect.poll(()=>hidden.counts().confirmed).toBe(1);
 await hidden.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(hidden.writes,['listening-time'],'a hidden viewing must not start its queued later writes');
 assert.equal(hidden.counts().completions,0);
 report.checks.push('Closing a viewing cancels private staging and later queued reveal/completion writes');
 await hidden.context.close();
 assert.deepEqual(report.errors,[]);
 await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
