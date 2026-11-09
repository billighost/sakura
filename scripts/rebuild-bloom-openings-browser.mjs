/** Real browser regression for openings and saved entrances. All application
 * API calls are intercepted; synthetic listeners never write to the database.
 * Run: node --import tsx scripts/rebuild-bloom-openings-browser.mjs
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';
import {buildBloomSnapshot} from '../src/rebuild/bloom/snapshot.ts';
import {bloomWindow} from '../src/rebuild/bloom/calendar.ts';
import {bloomProgressRecord} from '../src/rebuild/bloom/refresh.ts';
import {createBloomExperience} from '../src/rebuild/bloom/experience.ts';

const expect=baseExpect.configure({timeout:45000});
const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3013';
const worlds=(process.env.SAKURA_BLOOM_WORLDS||'sakura,jungle,disco,japan,china,korea,india,ocean,cosmos,glass').split(',');
const widths=(process.env.SAKURA_BLOOM_WIDTHS||'1280,390').split(',').map(Number);
const motions=(process.env.SAKURA_BLOOM_MOTIONS||'reduce,no-preference').split(',');
const concurrency=Math.max(1,Math.min(4,Number(process.env.SAKURA_BLOOM_CONCURRENCY)||2));
const capture=process.env.SAKURA_BLOOM_CAPTURE!=='0';
const output='.local/bloom-opening-review';await fs.mkdir(output,{recursive:true});
const screenshot=(page,path)=>capture?page.screenshot({path}):Promise.resolve();
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Synthetic auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000063',username:'Opening review',email:'opening@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const item=bloomWindow('monthly-2026-10',new Date('2026-11-09T12:00:00Z'));
const cards=Array.from({length:5},(_,index)=>{
 const id=`80000000-0000-4000-8000-${String(index+63).padStart(12,'0')}`;
 const artistId=`81000000-0000-4000-8000-${String(index<3?63:index+63).padStart(12,'0')}`;
 const name=index<3?'Utada Hikaru':index===3?'Burna Boy':'Little Simz',title=['One Last Kiss','Beautiful World','A Gentle Return','Garden in Music','Night Lanterns'][index];
 return {id,recordingId:id,title,artists:[name],artistId,artistImageUrl:null,albumId:null,albumTitle:'Opening fixture',metadata:{title,artists:[name]},coverUrl:`https://opening-fixture.invalid/cover-${index}.svg`,durationMs:30000,reference:{provider:'deezer',id:String(index+63)},references:[{provider:'deezer',id:String(index+63)}],genres:['Pop'],popularity:.5,playability:'resolvable',artistCredits:[{name,artistId,role:'primary'}]};
});
const built=buildBloomSnapshot(cards.map((card,index)=>({id:card.id,audible_ms:(5-index)*864000,plays:15-index,first_ever:index%2?'2026-09-01':'2026-10-08'})),cards,19,item);
const sampleRate=8000,wav=Buffer.alloc(44+sampleRate*30*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let index=0;index<sampleRate*30;index++)wav.writeInt16LE(Math.round(Math.sin(index/sampleRate*220*Math.PI*2)*150),44+index*2);
const report={scope:'Full Next UI; synthetic auth, saved bookmarks, generated audio and intercepted API writes.',expectedJourneys:worlds.length*widths.length*motions.length,journeys:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});

async function journey({world,width,motion}){
 const context=await browser.newContext({viewport:{width,height:width<500?844:900},reducedMotion:motion,serviceWorkers:'block'});
 const snapshot={...built,worldId:world,experience:createBloomExperience(`${account.id}|opening-review`,world)};
 const revealed=new Set(snapshot.chapters.slice(0,3).map(chapter=>chapter.id)),mutations=[];let completed=false;
 const recap=()=>({...item,...snapshot,chapterCount:snapshot.chapters.length,snapshotCreatedAt:'2026-11-09T10:00:00Z',expiresAt:'2099-11-24T00:00:00Z',status:'available',completed,chapters:snapshot.chapters.map(chapter=>({...chapter,revealed:revealed.has(chapter.id),stat:revealed.has(chapter.id)?chapter.stat:null,relatedRecording:revealed.has(chapter.id)?chapter.relatedRecording:null,recordings:revealed.has(chapter.id)?chapter.recordings:undefined,artists:revealed.has(chapter.id)?chapter.artists:undefined,comparison:revealed.has(chapter.id)?chapter.comparison:null}))});
 const bookmarkKey=`sakura-bloom-scene:${account.id}:${item.id}`,bookmark=JSON.stringify(bloomProgressRecord(recap(),2));
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(({bookmarkKey,bookmark})=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  if(!sessionStorage.getItem('opening-fixture-seeded')){localStorage.setItem(bookmarkKey,bookmark);sessionStorage.setItem('opening-fixture-seeded','1');}
  window.__openingContexts=[];
  window.__openingPhases=[];
  const recordOpening=()=>{
   const art=document.querySelector('[data-bloom-world] > [data-opening-phase]');if(!art)return;
   const phase=art.getAttribute('data-opening-phase');
   if(window.__openingPhases.at(-1)!==phase)window.__openingPhases.push(phase);
  };
  new MutationObserver(recordOpening).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-opening-phase']});
  const NativeContext=window.AudioContext;
  if(NativeContext){window.AudioContext=class extends NativeContext{constructor(...args){super(...args);window.__openingContexts.push(this);}};}
 },{bookmarkKey,bookmark});
 const page=await context.newPage();page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/opening-fixture.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',privateSession:true,reducedMotion:motion==='reduce',bloomPerformance:'5',onboarded:true,openingAnimation:0}});
  if(path==='/api/v2/image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#243851"/><circle cx="280" cy="125" r="110" fill="#e2b993"/><path d="M0 300Q140 105 400 320V400H0" fill="#889b8b"/></svg>'});
  if(path.endsWith('/reveal')){const chapterId=request.postDataJSON().chapterId,index=snapshot.chapters.findIndex(chapter=>chapter.id===chapterId);assert.ok(index>=0);assert.ok(snapshot.chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)),'sequential chapter reveal');mutations.push(chapterId);revealed.add(chapterId);return route.fulfill({json:recap()});}
  if(path.endsWith('/complete')){assert.equal(revealed.size,snapshot.chapters.length);completed=true;return route.fulfill({json:recap()});}
  if(path===`/api/v2/bloom/${item.id}`)return route.fulfill({json:recap()});
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:[{...item,worldId:world,chapterCount:snapshot.chapters.length,status:'available'}],schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/bloom/archive')return route.fulfill({json:{items:[]}});
  if(path==='/api/v2/recordings/resolve')return route.fulfill({json:{status:'resolved',recording:cards[0],playback:{url:'/opening-fixture.wav',assetId:'opening-fixture',sizeBytes:wav.length}}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
  return route.fulfill({json:{}});
 });
 const label=`${world}-${width}-${motion}`;
 try{
  await page.goto(`${base}/bloom/${item.id}?world=${world}`,{waitUntil:'domcontentloaded',timeout:90000});
  const dialog=page.locator('dialog[open]').filter({visible:true}),begin=dialog.locator('[data-bloom-action="begin"]'),art=dialog.locator('[data-bloom-world] > [data-opening-phase]').first();
  await begin.waitFor({state:'attached'});await expect(dialog.locator('[data-bloom-world]')).toHaveAttribute('data-bloom-world',world);await art.waitFor();
  // Capture the short entrance before the navigation and sound assertions.
  if(motion==='no-preference'){
   // The browser records the phase synchronously; a busy renderer may have
   // finished the short entrance before a remote Playwright assertion arrives.
   await expect.poll(()=>page.evaluate(()=>window.__openingPhases.includes('arriving')),{timeout:5000}).toBe(true);
   if(capture){await page.waitForTimeout(1600);await screenshot(page,`${output}/${label}-arrival.png`);
   await page.waitForTimeout(2200);await screenshot(page,`${output}/${label}-unfolding.png`);}
  }
  assert.equal(await dialog.locator('[aria-current="step"]').count(),0,'opening does not select saved chapter');
  assert.equal(mutations.length,0,'opening does not reveal a chapter');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookmarkKey),bookmark,'opening preserves saved bookmark');
  assert.equal(await dialog.evaluate(node=>Array.from(node.querySelectorAll('nav button')).every(button=>button.disabled)),true,'chapter navigation waits for entrance');
  await dialog.evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
  assert.equal(await dialog.locator('[aria-current="step"]').count(),0,'keyboard cannot skip entrance');
  const unlock=dialog.getByRole('button',{name:'Play opening music',exact:true});if(await unlock.count())await unlock.click();
  const mute=dialog.getByRole('button',{name:'Mute Bloom soundtrack',exact:true});
  if(await mute.count()){
   await mute.click();
   await expect.poll(()=>page.evaluate(()=>window.__openingContexts.every(context=>context.state==='closed'))).toBe(true);
   await dialog.getByRole('button',{name:'Enable Bloom soundtrack',exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>window.__openingContexts.some(context=>context.state==='running'))).toBe(true);
  }
  await expect(art).toHaveAttribute('data-opening-phase','settled',{timeout:15000});
  assert.equal(mutations.length,0,'settled artwork still waits for entrance');
  assert.equal(await dialog.evaluate(node=>node.scrollWidth>innerWidth),false,'opening has no horizontal overflow');
  if(motion==='reduce')assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length),0,'reduced motion uses a still opening');
  await screenshot(page,`${output}/${label}-settled.png`);
  await begin.click();
  if(motion==='no-preference')await screenshot(page,`${output}/${label}-entering.png`);
  await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter 3: ${snapshot.chapters[2].title}`);
  await screenshot(page,`${output}/${label}-chapter.png`);
  assert.equal(mutations.length,0,'saved revealed chapter resumes without another reveal');
  await expect.poll(()=>page.evaluate(()=>window.__openingContexts.every(context=>context.state==='closed'))).toBe(true);
  await dialog.locator('[data-bloom-action="next"]').click();
  await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter 4: ${snapshot.chapters[3].title}`);
  assert.deepEqual(mutations,[snapshot.chapters[3].id]);
  await dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();await page.waitForURL('**/bloom',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.__openingContexts.every(context=>context.state==='closed'))).toBe(true);
  await page.locator(`a[href="/bloom/${item.id}"]`).first().click();await begin.waitFor({state:'attached'});await art.waitFor();
  assert.equal(await dialog.locator('[aria-current="step"]').count(),0,'client-side revisit shows the opening again');
  const skipIfArriving=async()=>{await dialog.evaluate(node=>node.querySelector('[data-bloom-action="skip-opening"]')?.click());await expect(art).toHaveAttribute('data-opening-phase','settled');};
  if(motion==='no-preference'){await skipIfArriving();assert.deepEqual(mutations,[snapshot.chapters[3].id],'skipping decoration reveals no facts');}
  await begin.click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter 4: ${snapshot.chapters[3].title}`);
  await page.goBack({waitUntil:'domcontentloaded'});await page.waitForURL('**/bloom',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.__openingContexts.every(context=>context.state==='closed'))).toBe(true);
  await page.goForward({waitUntil:'domcontentloaded'});await begin.waitFor({state:'attached'});await art.waitFor();
  assert.equal(await dialog.locator('[aria-current="step"]').count(),0,'browser forward also shows the entrance');
  if(motion==='no-preference')await skipIfArriving();
  await begin.click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter 4: ${snapshot.chapters[3].title}`);
  if(world===worlds[0]&&width===widths[0]&&motion===motions[0]){
   for(let index=3;index<snapshot.chapters.length;index++){await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter ${index+1}: ${snapshot.chapters[index].title}`);await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();await dialog.locator('[data-bloom-action="next"]').click();}
   await dialog.getByRole('button',{name:'Play the story again',exact:true}).click();await begin.waitFor({state:'attached'});
   assert.equal(await dialog.locator('[aria-current="step"]').count(),0,'replay also starts at the opening');
   await begin.click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter 1: ${snapshot.chapters[0].title}`);
  }
  assert.deepEqual(errors,[]);
  const result={world,width,motion,opening:true,bookmarkPreserved:true,resumesChapter:3,clientRevisitResumesChapter:4,browserForwardResumesChapter:4,audioCleanup:true,noOverflow:true,errors};report.journeys.push(result);
  console.log(`Verified opening, audio and revisit: ${label}`);
 }catch(error){await page.screenshot({path:`${output}/${label}-failure.png`}).catch(()=>{});report.errors.push({label,error:String(error),pageErrors:errors});throw error;}finally{await context.close();}
}

try{
 const queue=widths.flatMap(width=>motions.flatMap(motion=>worlds.map(world=>({world,width,motion}))));
 await Promise.all(Array.from({length:concurrency},async()=>{while(queue.length){const next=queue.shift();try{await journey(next);}catch(error){console.error(`Failed ${next.world}-${next.width}-${next.motion}: ${error.message}`);}}}));
 await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
 assert.equal(report.errors.length,0,`${report.errors.length} opening journeys failed; see ${output}/report.json`);
 assert.equal(report.journeys.length,report.expectedJourneys,'every requested journey was checked');
}finally{await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
