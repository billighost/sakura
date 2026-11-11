/** Complete cinematic journeys with intercepted synthetic accounts, music and listening data. */
import 'dotenv/config';
import {encode} from 'next-auth/jwt';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {buildBloomSnapshot} from '../src/rebuild/bloom/snapshot.ts';
import {bloomWindow} from '../src/rebuild/bloom/calendar.ts';

const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3013';
const worlds=(process.env.SAKURA_BLOOM_WORLDS||'sakura,jungle,disco,japan,china,korea,india,ocean,cosmos,glass').split(',');
const widths=(process.env.SAKURA_BLOOM_WIDTHS||'1280,390').split(',').map(Number);
const profile=process.env.SAKURA_BLOOM_PROFILE==='1';
const output='.local/bloom-cinema-review';await fs.mkdir(output,{recursive:true});
const account={id:'90000000-0000-4000-8000-000000000041',username:'Bloom review',email:'bloom@example.invalid'};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret);
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const cards=Array.from({length:5},(_,i)=>{
 const id=`80000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
 const name=i<3?'宇多田ヒカル':i===3?'Tyler, The Creator':'Burna Boy';
 const artistId=`81000000-0000-4000-8000-${String(i<3?1:i).padStart(12,'0')}`;
 const title=['One Last Kiss','A Song with a Longer Title — 夜の庭','Beautiful World','The Music You Carried','A Familiar Return'][i];
 return {id,recordingId:id,title,artists:[name,'Credited Collaborator'],artistId,artistImageUrl:null,albumId:null,albumTitle:null,metadata:{title,artists:[name,'Credited Collaborator']},coverUrl:`https://bloom-fixture.invalid/cover-${i}.svg`,durationMs:30000,reference:{provider:'deezer',id:String(i+1)},references:[{provider:'deezer',id:String(i+1)}],genres:['Pop'],popularity:.5,playability:'resolvable',artistCredits:[{name,artistId,role:'primary'},{name:'Credited Collaborator',artistId:null,role:'featured'}]};
});
const window=bloomWindow('monthly-2026-10',new Date('2026-11-07T12:00:00Z'));
const snapshot=buildBloomSnapshot(cards.map((c,i)=>({id:c.id,audible_ms:(5-i)*864000,plays:15-i,first_ever:i%2?'2026-09-01':'2026-10-08'})),cards,19,window);
const wav=Buffer.alloc(44+8000*30*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<(wav.length-44)/2;i++)wav.writeInt16LE(Math.round(Math.sin(i/8000*220*Math.PI*2)*200),44+i*2);
const report={scope:'Full Next app; synthetic auth, listening snapshot, original illustrative covers and audio. All API writes intercepted.',journeys:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});let debug;
try{
 for(const width of widths)for(const world of worlds){
  const context=await browser.newContext({viewport:{width,height:width<500?844:900},reducedMotion:profile?'no-preference':'reduce',acceptDownloads:true,serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.__bloomAudios=[];window.Audio=function(...args){const audio=new NativeAudio(...args);window.__bloomAudios.push(audio);return audio;};window.Audio.prototype=NativeAudio.prototype;});
  const page=await context.newPage();debug=page;page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const revealed=new Set();let complete=false;const mutations=[];
  const recap=()=>({...window,...snapshot,worldId:world,chapterCount:snapshot.chapters.length,expiresAt:'2099-11-24T00:00:00+01:00',status:'available',completed:complete,chapters:snapshot.chapters.map(chapter=>({...chapter,revealed:revealed.has(chapter.id),stat:revealed.has(chapter.id)?chapter.stat:null,relatedRecording:revealed.has(chapter.id)?chapter.relatedRecording:null,recordings:revealed.has(chapter.id)?chapter.recordings:undefined,artists:revealed.has(chapter.id)?chapter.artists:undefined,comparison:revealed.has(chapter.id)?chapter.comparison:null}))});
  await page.route('**/fixture-bloom.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
   if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',privateSession:true,reducedMotion:!profile,bloomPerformance:'5',onboarded:true,openingAnimation:0}});
   if(path==='/api/v2/image'){
    const i=Number(url.searchParams.get('url')?.match(/cover-(\d)/)?.[1]||0);
    const palettes=[['#243851','#e2b993','#889b8b'],['#c79f85','#72525e','#d6ca9c'],['#315357','#cd976d','#d8d5b4'],['#3f3d59','#eac788','#91acaa'],['#899c81','#e5bd91','#426268']];const colours=palettes[i];
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${colours[0]}"/><circle cx="280" cy="125" r="110" fill="${colours[1]}"/><path d="M0 300Q140 105 400 320V400H0" fill="${colours[2]}"/><path d="M20 35H240M20 50H140" stroke="${colours[1]}" stroke-width="4"/></svg>`});
   }
   if(path.endsWith('/prepare'))return route.fulfill({json:{story:recap(),chapters:snapshot.chapters,listening:snapshot.listening}});
   if(path.endsWith('/reveal')){
    const chapterId=request.postDataJSON().chapterId,index=snapshot.chapters.findIndex(c=>c.id===chapterId);
    assert.ok(index>=0);assert.ok(snapshot.chapters.slice(0,index).every(c=>revealed.has(c.id)),'sequential reveal');
    mutations.push(chapterId);await new Promise(resolve=>setTimeout(resolve,60));revealed.add(chapterId);return route.fulfill({json:recap()});
   }
   if(path.endsWith('/complete')){assert.equal(revealed.size,snapshot.chapters.length);complete=true;return route.fulfill({json:recap()});}
   if(path===`/api/v2/bloom/${window.id}`)return route.fulfill({json:recap()});
   if(path==='/api/v2/bloom')return route.fulfill({json:{items:[{...window,worldId:world,chapterCount:snapshot.chapters.length,status:'available'}],schedule:{timeZone:'Africa/Lagos'}}});
   if(path==='/api/v2/bloom/archive')return route.fulfill({json:{items:[]}});
   if(path==='/api/v2/recordings/resolve')return route.fulfill({json:{status:'resolved',recording:cards[0],playback:{url:'/fixture-bloom.wav',assetId:'fixture',sizeBytes:wav.length}}});
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
   return route.fulfill({json:{}});
  });
  await page.goto(`${base}/bloom/${window.id}?world=${world}`,{waitUntil:'domcontentloaded',timeout:90000});
  const dialog=page.locator('dialog[open]');await dialog.locator('[data-bloom-action="begin"]').waitFor();await expect(dialog.getByRole('combobox',{name:'Bloom world',exact:true})).toHaveCount(0);
  await dialog.locator('[data-bloom-world]').waitFor();await page.screenshot({path:`${output}/${world}-opening-${width}.png`});
  await dialog.locator('[data-bloom-action="begin"]').click();
  let motionProfile;
  if(profile){
   await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();
   await page.waitForFunction(()=>window.__bloomAudios.some(audio=>!audio.paused&&audio.currentTime>0));
   await dialog.getByRole('button',{name:'Play story',exact:true}).click();
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   motionProfile=await page.evaluate(async()=>{
    const samples=[];let previous=0;
    await new Promise(resolve=>{function tick(now){if(previous)samples.push(now-previous);previous=now;if(samples.length===48)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});
    const sorted=samples.slice(4).sort((a,b)=>a-b);
    return {cpuThrottle:4,frameSamples:sorted.length,medianFrameMs:sorted[Math.floor(sorted.length/2)],p95FrameMs:sorted[Math.floor(sorted.length*.95)],svgNodes:document.querySelector('dialog').querySelectorAll('svg *').length,jsHeapBytes:performance.memory?.usedJSHeapSize};
   });
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
   await dialog.getByRole('button',{name:'Pause story',exact:true}).click();await expect(dialog).toHaveAttribute('data-paused','true');
   assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0,'manual pause stops motion');
   await page.waitForFunction(()=>window.__bloomAudios.every(audio=>audio.paused));
   await dialog.getByRole('button',{name:'Play story',exact:true}).click();
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(dialog).toHaveAttribute('data-paused','true');
   await page.waitForFunction(()=>window.__bloomAudios.every(audio=>audio.paused));
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
   await dialog.getByRole('button',{name:'Pause story',exact:true}).click();
   motionProfile.manualPause=true;motionProfile.hiddenTabPause=true;motionProfile.soundtrackPause=true;
  }
  for(let index=0;index<snapshot.chapters.length;index++){
   const chapter=snapshot.chapters[index];await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',`Chapter ${index+1}: ${chapter.title}`);
   await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();
   if(['comparison','song-winner','artist','artist-songs'].includes(chapter.kind)){
    await page.screenshot({path:`${output}/${world}-${chapter.kind}-${width}.png`});
    assert.equal(await dialog.evaluate(node=>node.scrollWidth>innerWidth),false,'no horizontal overflow');
    if(chapter.kind==='song-winner')assert.ok(await dialog.locator('img').count());
   }
   if(index===0){await dialog.evaluate(node=>{for(let press=0;press<3;press++)node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));});}
   else await dialog.locator('[data-bloom-action="next"]').click();
  }
  await dialog.locator('[data-bloom-action="save"]').waitFor();await expect.poll(()=>complete).toBe(true);assert.equal(new Set(mutations).size,mutations.length,'no repeated reveals');
  await page.screenshot({path:`${output}/${world}-finale-${width}.png`});
  await dialog.getByRole('button',{name:'Read my Bloom',exact:true}).click();await expect(dialog).toHaveAttribute('data-view','reading');assert.equal(await dialog.locator('section[data-kind]').count(),snapshot.chapters.length+1,'reading mode retains every fact and the finale');
  await dialog.getByRole('button',{name:'Return to cinema',exact:true}).click();await expect(dialog).toHaveAttribute('data-view','cinema');
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:45000}),dialog.locator('[data-bloom-action="save"]').click()]);
  const poster=`${output}/${world}-poster-${width}.png`;await download.saveAs(poster);const png=await fs.readFile(poster);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1920);assert.ok(png.length>30000,'poster has illustrated content');
  assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length),0,profile?'paused ending':'reduced-motion still');
  const worldChunks=await page.evaluate(()=>performance.getEntriesByType('resource').map(item=>item.name).filter(name=>name.includes('worlds_')&&name.includes('World')));
  assert.deepEqual(errors,[]);report.journeys.push({world,width,chapters:mutations.length,sequential:true,rapidNext:true,completed:true,reading:true,posterBytes:png.length,reducedMotion:!profile,motionProfile,worldChunks});
  await dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();await page.waitForURL('**/bloom');await context.close();
  console.log(`Verified ${world} ${width}px: complete journey and poster`);
 }
 await fs.writeFile(`${output}/${profile?'profile-report':'report'}.json`,JSON.stringify(report,null,2));
}catch(error){if(debug&&!debug.isClosed())await debug.screenshot({path:`${output}/failure.png`}).catch(()=>{});report.errors.push(String(error));await fs.writeFile(`${output}/${profile?'profile-report':'report'}.json`,JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
