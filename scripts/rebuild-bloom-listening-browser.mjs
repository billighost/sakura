/** Actual Next UI with synthetic signed auth, measured listening and generated
 * audio. Every product API write is intercepted; no real listener is changed.
 * Run with node --import tsx scripts/rebuild-bloom-listening-browser.mjs.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';
import {buildBloomSnapshot,discloseBloomChapter} from '../src/rebuild/bloom/snapshot.ts';
import {discloseBloomListening} from '../src/rebuild/bloom/listening.ts';
import {bloomWindow} from '../src/rebuild/bloom/calendar.ts';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3014';
const worlds=(process.env.SAKURA_BLOOM_WORLDS||'sakura,jungle,disco,japan,china,korea,india,ocean,cosmos,glass').split(',');
const widths=(process.env.SAKURA_BLOOM_WIDTHS||'1440,750,600,390,320').split(',').map(Number);
const output='.local/bloom-listening-review';await fs.mkdir(output,{recursive:true});
const reportPath=`${output}/${process.env.SAKURA_BLOOM_LAYOUT==='1'?'layout-report':process.env.SAKURA_BLOOM_TARGETED==='1'?'targeted-report':'report'}.json`;
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Synthetic signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000098',username:'Listening story fixture',email:'bloom-listening@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const cards=Array.from({length:6},(_,index)=>{
 const id=`80000000-0000-4000-8000-${String(index+198).padStart(12,'0')}`;
 const name=index<3?'宇多田ヒカル':index===3?'Tyler, The Creator':index===4?'Burna Boy':'Little Simz';
 const artistId=`81000000-0000-4000-8000-${String(index<3?198:index+198).padStart(12,'0')}`;
 const title=['One Last Kiss','A Song with a Very Long Title — 夜の庭 — An Extended Listening Recording','Beautiful World','The Music You Carried','A Familiar Return','Another Listening Moment'][index];
 const genres=[['Pop','R&B'],['Pop'],['Electronic','Pop'],['Hip-Hop'],['Afrobeats'],[]][index];
 return {id,recordingId:id,title,artists:[name],artistsComplete:true,artistId,artistImageUrl:null,albumId:null,albumTitle:'Synthetic listening story',metadata:{title,artists:[name],durationMs:30000,genres,version:{kinds:['original'],labels:[]}},coverUrl:`https://bloom-fixture.invalid/cover-${index}.svg`,durationMs:30000,reference:{provider:'deezer',id:String(index+198)},references:[{provider:'deezer',id:String(index+198)}],version:{kinds:['original'],labels:[]},genres,popularity:.5,playability:'resolvable',artistCredits:[{name,artistId,role:'primary'}]};
});
const item=bloomWindow('monthly-2026-10',new Date('2026-11-08T12:00:00Z'));
const rows=cards.map((card,index)=>({id:card.id,audible_ms:(6-index)*864000,plays:8-index,first_ever:index<3?'2026-09-10T08:00:00Z':index===5?null:'2026-10-08T12:00:00Z'}));
const hours=Array.from({length:24},(_,hour)=>({hour,audibleMs:hour===20?rows.reduce((sum,row)=>sum+row.audible_ms,0)*.6:hour===8?rows.reduce((sum,row)=>sum+row.audible_ms,0)*.4:0}));
const rich=buildBloomSnapshot(rows,cards,19,item,{hours,knownBeforeRecordingIds:cards.slice(0,3).map(card=>card.id),knownBeforeArtistKeys:[cards[0].artistId],discoveryUnknownIds:[cards[5].id],previous:{periodLabel:'September 2026',rows:rows.slice(0,3).map(row=>({...row,audible_ms:row.audible_ms/2})),cards:cards.slice(0,3)}});
assert.equal(rich.listening.genreCount,5);assert.equal(rich.listening.peakHour,20);assert.equal(rich.listening.discoveredRecordingCount,2);assert.equal(rich.listening.returningArtistCount,1);
assert.ok(Math.abs(rich.listening.genres.reduce((sum,genre)=>sum+genre.audibleMs,0)+rich.listening.unknownGenreMs-rich.summary.audibleMs)<1,'Genre time divides each recording without duplication');
const sparseCard={...cards[5],artistId:null,artistCredits:[],genres:[]};
const sparse=buildBloomSnapshot([{id:sparseCard.id,audible_ms:45000,plays:1,first_ever:null}],[sparseCard],1,item,{discoveryUnknownIds:[sparseCard.id]});
const annual=bloomWindow('yearly-2025',new Date('2026-11-08T12:00:00Z'));
const legacy={...buildBloomSnapshot(rows.map(row=>({...row,first_ever:row.first_ever?.replace('2026','2025')||null})),cards,19,annual),version:2,experience:undefined,listening:undefined};
const related={version:1,summary:{audibleMs:900000,playCount:12,recordingCount:1,activeDays:4},chapters:[{id:'top-song',kind:'song-winner',title:'A saved listening moment.',prompt:'',stat:{label:'One Last Kiss',value:'15min',unit:''},relatedRecording:cards[0]}]};
const empty=buildBloomSnapshot([],[],0,item);
const rate=8000,wav=Buffer.alloc(44+rate*30*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let index=0;index<rate*30;index++)wav.writeInt16LE(Math.round(Math.sin(index/rate*220*Math.PI*2)*200),44+index*2);
const report={scope:'Real Next UI; signed synthetic account, split-tag listening measurements, retained-history dates, original illustrative fixture artwork and generated WAV. All product API writes intercepted; live providers are outside this fixture.',journeys:[],checks:[],errors:[],screenshots:[],layouts:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});let debug,debugInfo;
async function journey(world,width,variant='rich'){
 const snapshot=variant==='sparse'?sparse:variant==='legacy'?legacy:variant==='related'?related:variant==='empty'?empty:rich;
 const archival=variant==='legacy'||variant==='related',period=archival?annual:item;
 const moving=variant==='motion',low=variant==='low';
 const theme=width===320&&variant==='rich'?'dark':'light';
 const context=await browser.newContext({viewport:{width,height:variant==='short'?600:width<500?700:800},reducedMotion:moving?'no-preference':'reduce',acceptDownloads:true,serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.__bloomAudios=[];window.Audio=function(...args){const audio=new NativeAudio(...args);window.__bloomAudios.push(audio);return audio;};window.Audio.prototype=NativeAudio.prototype;});
 const page=await context.newPage();debug=page;debugInfo={world,width,variant,phase:'loading',requests:[]};page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydration|hydrated|did not match|uncaught|minified react error/i.test(message.text()))errors.push(message.text());});
 const revealed=new Set(archival?snapshot.chapters.map(chapter=>chapter.id):variant==='refresh'?snapshot.chapters.slice(0,2).map(chapter=>chapter.id):[]),mutations=[],clears=[];let completed=archival,releaseErased,serverReadCompleted=false;const stamp='2026-11-08T12:00:00.000Z';
 const erasedGate=new Promise(resolve=>{releaseErased=resolve;});
 const recap=()=>({...period,...snapshot,worldId:world,snapshotCreatedAt:archival?undefined:stamp,chapterCount:snapshot.chapters.length,expiresAt:'2099-11-24T00:00:00+01:00',status:archival?'archived':variant==='empty'?'empty':'available',completed,
  listening:discloseBloomListening(snapshot.listening,new Set(snapshot.chapters.filter(chapter=>revealed.has(chapter.id)).flatMap(chapter=>[chapter.kind,chapter.id])),completed),
  chapters:snapshot.chapters.map(chapter=>discloseBloomChapter(chapter,revealed.has(chapter.id)))});
 await context.route('**/fixture-bloom-listening.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path.startsWith('/api/v2/bloom'))debugInfo.requests.push({method:request.method(),path});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{theme,privateSession:true,learnFromListening:false,reducedMotion:!moving,bloomPerformance:low?'1':'5',onboarded:true,openingAnimation:0,volume:.2,timeZone:'Africa/Lagos'}});
  if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
  if(path==='/api/v2/image'){
   const index=Number(url.searchParams.get('url')?.match(/cover-(\d)/)?.[1]||0);
   const colours=[['#243851','#e2b993','#889b8b'],['#c79f85','#72525e','#d6ca9c'],['#315357','#cd976d','#d8d5b4'],['#3f3d59','#eac788','#91acaa'],['#899c81','#e5bd91','#426268'],['#365b62','#e1d7c3','#baa0a8']][index];
   return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${colours[0]}"/><circle cx="280" cy="125" r="110" fill="${colours[1]}"/><path d="M0 300Q140 105 400 320V400H0" fill="${colours[2]}"/><path d="M20 35H240M20 50H140" stroke="${colours[1]}" stroke-width="4"/></svg>`});
  }
  if(path.endsWith('/reveal')){
   const chapterId=request.postDataJSON().chapterId,index=snapshot.chapters.findIndex(chapter=>chapter.id===chapterId);
   assert.ok(index>=0);assert.ok(snapshot.chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)),'Reveals stay sequential');
   mutations.push(chapterId);if(variant==='rebuild'){revealed.add(chapterId);const different=recap();different.snapshotCreatedAt='2026-11-08T13:00:00.000Z';await erasedGate;return route.fulfill({json:different}).catch(()=>{});}if(variant==='erase')await erasedGate;else await new Promise(resolve=>setTimeout(resolve,25));revealed.add(chapterId);return route.fulfill({json:recap()}).catch(()=>{});
  }
  if(path.endsWith('/complete')){assert.equal(revealed.size,snapshot.chapters.length);completed=true;return route.fulfill({json:recap()});}
  if(path===`/api/v2/bloom/${period.id}`){if(variant==='refresh')await erasedGate;await route.fulfill({json:recap()});serverReadCompleted=true;return;}
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:[{...period,worldId:world,chapterCount:snapshot.chapters.length,status:'available'}],schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/bloom/archive')return route.fulfill({json:{items:archival?[recap()]:[]}});
  if(path==='/api/v2/personalization/data'){if(request.method()==='DELETE')clears.push(request.postDataJSON());return route.fulfill({json:{cleared:true,cutoff:new Date().toISOString()}});}
  if(path==='/api/v2/recordings/resolve'){const index=cards.findIndex(card=>card.reference.id===request.postDataJSON().reference?.id);return route.fulfill({json:{status:'resolved',recording:cards[Math.max(0,index)],playback:{url:'/fixture-bloom-listening.wav',assetId:cards[0].id,sizeBytes:wav.length}}});}
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:[],playlists:[]}});
  return route.fulfill({json:{}});
 });
 async function capture(label){await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>[...document.querySelectorAll('dialog img')].every(image=>image.complete));const layout=await verticalFit();report.layouts.push({world,width,variant,label,...layout});const path=`${output}/${world}-${variant}-${label}-${width}.png`;await page.screenshot({path});report.screenshots.push(path);}
 async function verticalFit(){const layout=await dialog.evaluate(node=>{const canvas=node.querySelector('[class*="canvas"]'),heading=node.querySelector('[class*="finishCopy"]>h2')||node.querySelector('.bloom-content>h2'),section=heading?.parentElement,footerTop=node.querySelector('footer')?.getBoundingClientRect().top,headerBottom=node.querySelector('header')?.getBoundingClientRect().bottom,progressBottom=node.querySelector('nav')?.getBoundingClientRect().bottom;return {scrollTop:canvas?.scrollTop,scrollHeight:canvas?.scrollHeight,canvasHeight:canvas?.clientHeight,heading:heading?.getBoundingClientRect().toJSON(),content:section?.getBoundingClientRect().toJSON(),headerBottom,progressBottom,footerTop,reading:node.getAttribute('data-view')==='reading'};});debugInfo.layout=layout;if(!layout.reading&&(process.env.SAKURA_BLOOM_LAYOUT!=='1'||process.env.SAKURA_BLOOM_LAYOUT_STRICT==='1')&&layout.heading){assert.ok(layout.heading.top>=Math.max(layout.headerBottom,layout.progressBottom)+4,`${world} ${width}px starts its heading below fixed story controls`);assert.ok(layout.content.bottom-(layout.scrollHeight-layout.canvasHeight-layout.scrollTop)<=((layout.footerTop??layout.canvasHeight)-12),`${world} ${width}px can scroll all chapter content above the fixed controls`);}return layout;}
 // Authored vines and ink may extend beyond the text column as pseudo-elements.
 // Check real controls and text rather than rejecting their decorative scrollWidth.
 async function fit(){const result=await page.locator('dialog[open]').evaluate(dialog=>{const overflow=[...dialog.querySelectorAll('.bloom-content')].flatMap(node=>{const box=node.getBoundingClientRect();return [...node.querySelectorAll('*')].flatMap(element=>{const bounds=element.getBoundingClientRect();if(!bounds.width||!bounds.height)return [];const range=document.createRange();range.selectNodeContents(element);const text=/^(H[1-6]|P|SMALL|SPAN|A|BUTTON|SELECT)$/.test(element.tagName)&&element.textContent?.trim()?range.getBoundingClientRect():bounds;return bounds.left<box.left-1||bounds.right>box.right+1||text.left<box.left-1||text.right>box.right+1?[{tag:element.tagName,class:element.className?.baseVal??element.className,text:element.textContent?.slice(0,100),bounds:bounds.toJSON(),textBounds:text.toJSON(),column:box.toJSON()}]:[];});});const controls=[...dialog.querySelectorAll('header button')].map(node=>node.getBoundingClientRect());return {dialog:dialog.scrollWidth<=innerWidth+1,content:overflow.length===0,document:document.documentElement.scrollWidth<=innerWidth+1,overflow,targets:controls.every(box=>box.width>=44&&box.height>=44),controlsDoNotOverlap:controls.every((box,index)=>controls.slice(index+1).every(other=>box.right<=other.left||other.right<=box.left||box.bottom<=other.top||other.bottom<=box.top))};});debugInfo.overflow=result.overflow;assert.deepEqual({dialog:result.dialog,content:result.content,document:result.document,targets:result.targets,controlsDoNotOverlap:result.controlsDoNotOverlap},{dialog:true,content:true,document:true,targets:true,controlsDoNotOverlap:true},`${world} ${width}px ${variant} fits`);}
 if(variant==='refresh'){
  await page.goto(base+'/home',{waitUntil:'domcontentloaded'});await page.locator('#music-main h1').first().waitFor();await page.evaluate(async({owner,key,data})=>{const request=indexedDB.open('sakura-ink-v1',1),database=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('entries'))request.result.createObjectStore('entries');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const transaction=database.transaction('entries','readwrite');transaction.objectStore('entries').put({data,updatedAt:Date.now()-130000},`account:${owner}:resource:${key}`);await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});database.close();},{owner:account.id,key:`/api/v2/bloom/${period.id}`,data:recap()});
 }
 await page.goto(`${base}/bloom/${period.id}?world=${world}${archival?'&archive=1':''}`,{waitUntil:'domcontentloaded',timeout:90000});
 const dialog=page.locator('dialog[open]');await dialog.locator(`[data-bloom-world="${world}"]`).waitFor();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await fit();
 if(variant==='empty'){await expect(dialog).toContainText('No listening was recorded for this period.');await expect(dialog.locator('[data-bloom-action="begin"]')).toHaveCount(0);assert.equal(await dialog.locator('[data-listening-motif]').count(),0);await capture('opening');assert.deepEqual(errors,[]);report.checks.push(`${world}: empty story has no invented measurements or playback action`);await context.close();return;}
 await dialog.locator('[data-bloom-action="begin"]').waitFor();
 if(!archival)assert.equal(await dialog.locator('[data-listening-motif]').count(),0,'Unrevealed measurements do not appear as artwork');
 if(variant==='rich')await capture('opening');
 await dialog.locator('[data-bloom-action="begin"]').click();
 if(variant==='erase'){
  await expect.poll(()=>mutations.length).toBe(1);await page.evaluate(accountId=>window.dispatchEvent(new CustomEvent('sakura-personalization-cleared',{detail:{accountId,scope:'history',period:'all'}})),account.id);
  await expect(page.locator('dialog[open]')).toHaveCount(0);releaseErased();await page.waitForURL('**/bloom');await page.waitForTimeout(200);await expect(page.locator('dialog[open]')).toHaveCount(0);assert.deepEqual(errors,[]);report.checks.push('History erasure closes a pending story and its late reveal cannot restore the erased dialog');await context.close();return;
 }
 if(variant==='rebuild'){
  await expect.poll(()=>mutations.length).toBe(1);releaseErased();await expect(dialog.locator('[data-bloom-action="begin"]')).toBeEnabled();await expect(dialog.locator('[role="alert"]')).toBeVisible();await expect(dialog.locator('[aria-current="step"]')).toHaveCount(0);assert.deepEqual(errors,[]);report.checks.push('A delayed reveal for a different story creation date cannot replace the current period');await context.close();return;
 }
 if(variant==='refresh'||variant==='feedback'){
  await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();await dialog.locator('[data-bloom-action="next"]').click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',/^Chapter 2:/);const progressKey=`sakura-bloom-scene:${account.id}:${period.id}`,saved=await page.evaluate(key=>localStorage.getItem(key),progressKey);
  if(variant==='refresh'){await page.waitForFunction(()=>window.__bloomAudios.some(audio=>!audio.paused&&audio.currentTime>.1));const source=await page.evaluate(()=>window.__bloomAudios.find(audio=>!audio.paused)?.src);releaseErased();await expect.poll(()=>serverReadCompleted).toBe(true);await page.waitForTimeout(200);await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',/^Chapter 2:/);assert.equal(await page.evaluate(key=>localStorage.getItem(key),progressKey),saved);assert.equal(await page.evaluate(()=>window.__bloomAudios.find(audio=>!audio.paused)?.src),source);assert.deepEqual(errors,[]);report.checks.push('An unchanged delayed refresh of an older saved page preserves the open chapter, soundtrack and saved position');await context.close();return;}
  const erasureKey=`sakura-v2-listening-resource-erased:${account.id}`,marker=await page.evaluate(key=>localStorage.getItem(key),erasureKey),other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(base+'/settings',{waitUntil:'domcontentloaded'});const data=other.getByRole('region',{name:'Your listening data'});await data.getByLabel('What to clear').selectOption('feedback');await data.getByLabel('Time period').selectOption('all');await data.getByRole('button',{name:'Clear selected data',exact:true}).click();await other.getByRole('dialog').getByRole('button',{name:'Clear this data',exact:true}).click();await expect.poll(()=>clears.length).toBe(1);await expect(other.getByRole('dialog')).toHaveCount(0);await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',/^Chapter 2:/);assert.equal(await page.evaluate(key=>localStorage.getItem(key),progressKey),saved);assert.equal(await page.evaluate(key=>localStorage.getItem(key),erasureKey),marker,'Feedback-only clearing leaves history marker intact');
  await data.getByLabel('What to clear').selectOption('history');await data.getByRole('button',{name:'Clear selected data',exact:true}).click();await other.getByRole('dialog').getByRole('button',{name:'Clear this data',exact:true}).click();await expect.poll(()=>clears.length).toBe(2);await expect(page.locator('dialog[open]')).toHaveCount(0);await page.waitForURL('**/bloom');assert.deepEqual(errors,[]);report.checks.push('Feedback-only clearing in a second tab preserves the listening story and progress; history clearing revokes both');await context.close();return;
 }
 if(moving){
  await expect(dialog.getByRole('button',{name:'Play story',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Play story',exact:true}).click();await expect(dialog.getByRole('button',{name:'Pause story',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Pause story',exact:true}).click();await expect(dialog).toHaveAttribute('data-paused','true');debugInfo.runningAnimations=await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').map(animation=>({type:animation.constructor.name,name:animation.animationName,property:animation.transitionProperty,target:animation.effect?.target?.className?.baseVal??animation.effect?.target?.className})));assert.equal(debugInfo.runningAnimations.length,0,'Pausing story stops artwork animation');await page.waitForFunction(()=>window.__bloomAudios.every(audio=>audio.paused));
  await dialog.getByRole('button',{name:'Play story',exact:true}).click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(dialog).toHaveAttribute('data-paused','true');await page.waitForFunction(()=>window.__bloomAudios.every(audio=>audio.paused));await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await dialog.getByRole('button',{name:'Pause story',exact:true}).click();report.checks.push(`${world}: motion and soundtrack pause with story controls and a hidden tab`);
 }
 if(world==='sakura'&&width===widths[0]&&variant==='rich'){
  await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();await expect(dialog.getByRole('combobox',{name:'Bloom world',exact:true})).toHaveCount(0);report.checks.push('The assigned Bloom world stays a surprise and cannot be changed inside the story');
 }
 let audioChecked=false;
 for(let index=0;index<snapshot.chapters.length;index++){
  debugInfo.phase=`chapter ${index+1}: ${snapshot.chapters[index].id}`;
  const chapter=snapshot.chapters[index];await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',new RegExp(`^Chapter ${index+1}:`));await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();await fit();await verticalFit();assert.ok(await dialog.locator('[data-bloom-action="next"]').evaluate(button=>{const bounds=button.getBoundingClientRect();return bounds.top>=0&&bounds.bottom<=innerHeight+1&&bounds.width>=44&&bounds.height>=44;}),'Next remains visible with a 44px touch target');
  if((['returns','genres','pattern','song-winner'].includes(chapter.kind)||chapter.id==='period-comparison'||chapter.id==='runner-up')&&['rich','short'].includes(variant))await capture(chapter.id==='period-comparison'||chapter.id==='runner-up'?chapter.id:chapter.kind);
  if(chapter.id==='period-comparison'&&variant==='rich'){await expect(dialog).toContainText('September 2026');await expect(dialog).toContainText('3 songs');}
  if(chapter.id==='listening-hours'&&variant==='rich'){await expect(dialog).toContainText('20:00–21:00');await expect(dialog).toContainText('Africa/Lagos');}
  if(chapter.kind==='song-winner'&&variant==='rich'){
   await dialog.getByRole('button',{name:/^Play One Last Kiss$/}).click();await page.waitForFunction(()=>window.__bloomAudios.some(audio=>!audio.paused&&audio.currentTime>.1));
   await dialog.getByRole('button',{name:'Mute Bloom soundtrack',exact:true}).click();await page.waitForFunction(()=>window.__bloomAudios.every(audio=>audio.paused));audioChecked=true;
  }
  if(variant==='related'){const text=await dialog.locator('.bloom-artworks article').innerText();assert.doesNotMatch(text,/0(?:min|s) listened|0 plays|^01$/m,'Old recording-only stories do not manufacture zero measurements or a rank');report.checks.push('Legacy related-recording chapters preserve song artwork and credits without invented zero time, plays or ranking');}
  if(chapter.id==='returning-songs'&&variant==='rich'&&width<500&&(process.env.SAKURA_BLOOM_LAYOUT!=='1'||process.env.SAKURA_BLOOM_LAYOUT_STRICT==='1')){const canvas=dialog.locator('[class*="canvas"]').first();await canvas.evaluate(node=>{node.scrollTop=node.scrollHeight;});assert.ok(await canvas.evaluate(node=>node.scrollTop)>0,'Long listening chapters can be scrolled');const end=await dialog.locator('.bloom-content').evaluate(node=>node.getBoundingClientRect().bottom),safeBottom=await dialog.locator('footer').evaluate(node=>node.getBoundingClientRect().top);assert.ok(end<=safeBottom-12,'Scrolling reaches the last listening explanation above the controls');await dialog.locator('[data-bloom-action="next"]').click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',new RegExp(`^Chapter ${index+2}:`));await expect.poll(()=>canvas.evaluate(node=>node.scrollTop)).toBe(0);report.checks.push(`${world} ${width}px: long listening chapters scroll above the controls and Next starts the following chapter at the top`);}
  else if(index===0&&!archival)await dialog.evaluate(node=>{for(let press=0;press<3;press++)node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));});
  else await dialog.locator('[data-bloom-action="next"]').click();
 }
 await dialog.locator('[data-bloom-action="save"]').waitFor();assert.ok(completed);assert.equal(new Set(mutations).size,mutations.length,'Rapid Next does not repeat reveals');
 if(archival)assert.equal(mutations.length,0,'Opening a saved archive sends no reveal writes');
 const motifs=await dialog.locator('[data-listening-motif]').evaluateAll(nodes=>nodes.map(node=>({kind:node.getAttribute('data-listening-motif'),children:node.querySelectorAll('*').length})));
 if(['rich','motion','low'].includes(variant))assert.ok(motifs.length>0,`${world} has world-specific listening art`);
 if(archival)assert.equal(motifs.length,0,'Legacy stories do not invent missing measurements');
 await fit();await capture('finale');
 await dialog.getByRole('button',{name:'Read my Bloom',exact:true}).click();await expect(dialog).toHaveAttribute('data-view','reading');assert.equal(await dialog.locator('section[data-kind]').count(),snapshot.chapters.length+(variant==='related'?0:1),'Reading preserves every chapter and finale');await fit();
 await dialog.getByRole('button',{name:'Return to cinema',exact:true}).click();await expect(dialog).toHaveAttribute('data-view','cinema');
 let posterBytes=0;
 if(variant==='rich'&&width===widths[0]){
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),dialog.locator('[data-bloom-action="save"]').click()]);
  const path=`${output}/${world}-poster.png`;await download.saveAs(path);const png=await fs.readFile(path);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1920);assert.ok(png.length>30000,'Poster contains illustrated content');posterBytes=png.length;report.screenshots.push(path);
 }
 if(!moving)assert.equal(await dialog.evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length),0,'Reduced motion stays still');if(low)await expect(dialog).toHaveAttribute('data-quality','1');assert.deepEqual(errors,[]);
 report.journeys.push({world,width,variant,theme,chapters:snapshot.chapters.length,reveals:mutations.length,sequential:true,reading:true,audio:audioChecked,posterBytes,motifs,reducedMotion:!moving});
 await dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();await page.waitForURL('**/bloom');await context.close();console.log(`Verified ${world} ${variant} ${width}px`);
}
async function archiveCovers(){
 const context=await browser.newContext({viewport:{width:390,height:700},reducedMotion:'reduce',serviceWorkers:'block'});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 const page=await context.newPage();debug=page;page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const archives=worlds.map((world,index)=>{const year=2015+index;return {...annual,...rich,id:`yearly-${year}`,periodStart:`${year}-01-01T00:00:00+01:00`,periodEnd:`${year+1}-01-01T00:00:00+01:00`,worldId:world,status:'archived',completed:true,chapterCount:rich.chapters.length,chapters:rich.chapters.map(chapter=>discloseBloomChapter(chapter,true))};});
 archives.push({...annual,...legacy,id:'yearly-2001',worldId:'japan',status:'archived',completed:true,chapterCount:legacy.chapters.length,chapters:legacy.chapters.map(chapter=>discloseBloomChapter(chapter,true))});
 await page.route('**/api/**',route=>{const url=new URL(route.request().url()),path=url.pathname;if(path==='/api/auth/session')return route.fulfill({json:{user:account}});if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});if(path==='/api/v2/settings')return route.fulfill({json:{theme:'dark',privateSession:true,learnFromListening:false,reducedMotion:true,bloomPerformance:'1',onboarded:true,openingAnimation:0,timeZone:'Africa/Lagos'}});if(path==='/api/v2/bloom')return route.fulfill({json:{items:[],schedule:{timeZone:'Africa/Lagos'}}});if(path==='/api/v2/bloom/archive')return route.fulfill({json:{items:archives}});return route.fulfill({json:{session:null,recordings:[],playlists:[]}});});
 await page.goto(base+'/bloom',{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('button',{name:'Yearly',exact:true}).click();await expect(page.locator('[data-bloom-cover-listening]')).toHaveCount(worlds.length);
 const covers=page.locator('[data-bloom-cover-listening]');for(let index=0;index<worlds.length;index++){await covers.nth(index).scrollIntoViewIfNeeded();await covers.nth(index).locator('..').locator('img').evaluate(image=>image.decode());}
 const kinds=await covers.evaluateAll(nodes=>nodes.map(node=>({world:node.getAttribute('data-bloom-cover-listening'),drawing:node.querySelector('g')?.innerHTML})));
 assert.equal(new Set(kinds.map(kind=>kind.drawing)).size,worlds.length,'Archive annotations have distinct authored drawings');assert.equal(await page.locator('[data-bloom-world]').count(),0,'Archive cover scrolling never mounts cinematic worlds');
 const retained=await page.locator('[data-bloom-cover]').evaluateAll(nodes=>{window.__archiveCovers=nodes;return nodes.length;});
 await page.locator('#music-main').evaluate(async main=>{for(let index=0;index<3;index++){main.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(resolve));main.scrollTop=main.scrollHeight;await new Promise(resolve=>requestAnimationFrame(resolve));}});
 assert.equal(await page.locator('[data-bloom-cover]').evaluateAll(nodes=>nodes.length===window.__archiveCovers.length&&nodes.every((node,index)=>node===window.__archiveCovers[index])),true,'Cover DOM stays stable while scrolling');assert.equal(await page.locator('[data-bloom-cover]').count(),retained);assert.deepEqual(errors,[]);
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await covers.first().scrollIntoViewIfNeeded();const path=`${output}/archive-covers-390-dark.png`;await page.screenshot({path});report.screenshots.push(path);report.checks.push('All ten archive covers use distinct static listening marks; legacy cover stays unannotated and scrolling preserves bitmap DOM');await context.close();
}
try{
 if(process.env.SAKURA_BLOOM_TARGETED!=='1'){for(const width of widths)for(const world of worlds)await journey(world,width);if(process.env.SAKURA_BLOOM_VARIANTS!=='0')for(const variant of ['sparse','legacy'])for(const world of worlds)await journey(world,320,variant);}
 if(process.env.SAKURA_BLOOM_VARIANTS!=='0'&&process.env.SAKURA_BLOOM_LAYOUT!=='1'){await journey('sakura',320,'empty');await journey('ocean',390,'erase');await journey('jungle',390,'motion');await journey('glass',320,'low');await journey('japan',1024,'short');await journey('japan',320,'related');await journey('sakura',390,'refresh');await journey('ocean',390,'feedback');await journey('glass',390,'rebuild');await archiveCovers();}
 await fs.writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({journeys:report.journeys.length,checks:report.checks.length,posters:report.journeys.filter(journey=>journey.posterBytes).length,errors:report.errors}));
}catch(error){if(debug&&!debug.isClosed()){await debug.screenshot({path:`${output}/failure.png`}).catch(()=>{});report.debug={...debugInfo,ui:await debug.evaluate(()=>({url:location.href,dialog:document.querySelector('dialog')?.innerText,current:document.querySelector('[aria-current="step"]')?.getAttribute('aria-label')})).catch(()=>null)};}report.errors.push(String(error));await fs.writeFile(reportPath,JSON.stringify(report,null,2));console.error(JSON.stringify(report.debug));throw error;}finally{await browser.close();}
