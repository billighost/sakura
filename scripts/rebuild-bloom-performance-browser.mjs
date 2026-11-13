/** Production Bloom UI, verified generated soundtrack, native artwork variants
 * and settled-world frame samples. Every account/provider API is intercepted. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import {chromium,webkit,expect as baseExpect} from '@playwright/test';
import {bloomAudioFixture} from './fixtures/bloom-audio.mjs';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3117';
const baseline=process.env.SAKURA_BLOOM_PERF_BASELINE==='1',matrix=process.env.SAKURA_BLOOM_PERF_MATRIX==='1',reducedMotion=process.env.SAKURA_BLOOM_PERF_REDUCED_MOTION==='1';
const engine=process.env.SAKURA_BLOOM_BROWSER||'chromium';
const allWorlds=['sakura','jungle','disco','japan','china','korea','india','ocean','cosmos','glass'];
const worlds=(process.env.SAKURA_BLOOM_PERF_WORLDS||(matrix?allWorlds.join(','):'sakura')).split(',');
const tiers=(process.env.SAKURA_BLOOM_PERF_TIERS||(matrix?'1,2,3,4,5':'5')).split(',').map(value=>value==='auto'?'auto':Number(value));
assert.ok(worlds.every(world=>allWorlds.includes(world)));assert.ok(tiers.every(tier=>tier==='auto'||Number.isInteger(tier)&&tier>=1&&tier<=5));
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Synthetic auth signing configuration is required.');
const expect=baseExpect.configure({timeout:30000}),account={id:'90000000-0000-4000-8000-000000000597',username:'Bloom performance fixture'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const recordings=Array.from({length:20},(_,index)=>{
 const id=`80000000-0000-4000-8000-${String(index+597).padStart(12,'0')}`,reference={provider:'deezer',id:String(index+597)},title=`Prepared song ${index+1}`,artists=['Synthetic artist'],version={kinds:['original'],labels:[]};
 return {id,recordingId:id,title,artists,durationMs:30000,coverUrl:`https://cdn-images.dzcdn.net/images/cover/${index.toString(16).padStart(32,'0')}/1000x1000-000000-80-0-0.jpg`,reference,references:[reference],version,metadata:{title,artists,durationMs:30000,version}};
});
const chapters=recordings.map((recording,index)=>({id:index===19?'top-song':`chapter-${index}`,kind:'songs',title:`A listening chapter ${index+1}.`,prompt:'',stat:{label:'Songs',value:index+1,unit:''},relatedRecording:recording,recordings:[{rank:1,audibleMs:30000,plays:1,recording}]}));
const shell={id:'monthly-2026-10',period:'monthly',periodStart:'2026-10-01T00:00:00+01:00',periodEnd:'2026-11-01T00:00:00+01:00',publishAt:'2026-11-01T00:00:00+01:00',expiresAt:'2099-11-24T00:00:00+01:00',timeZone:'Africa/Lagos',status:'available',version:3,snapshotCreatedAt:'2026-11-11T08:00:00Z',chapterCount:chapters.length,summary:{audibleMs:600000,recordingCount:20,playCount:20,activeDays:4}};
const samples=8000*30,audio=Buffer.alloc(44+samples,128);audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write('data',36);audio.writeUInt32LE(samples,40);
const sha256=createHash('sha256').update(audio).digest('hex'),fixtureAudio=bloomAudioFixture(recordings,audio);
const output='.local/bloom-performance';await fs.mkdir(output,{recursive:true});
const suffix=`${baseline?'before':'after'}-${engine}${matrix?'-matrix':''}${tiers.every(tier=>tier==='auto')?'-auto':''}${reducedMotion?'-reduced-motion':''}`,buildId=(await fs.readFile('.next/BUILD_ID','utf8')).trim(),report={baseline,matrix,engine,buildId,baseUrl:base,reducedMotion,requestedWorlds:worlds,requestedTiers:tiers,scope:'Local production UI at390px/DPR2 with20verified generated full soundtrack files and intercepted native-format artwork;1500ms settled-scene samples. Routed requests disable native HTTP caching, so repeated identical image requests are reported separately from prepared source identity. Desktop browser/host results do not certify physical-device GPU, thermal behavior or production percentiles.',journeys:[],errors:[]};
if(process.env.SAKURA_BLOOM_PERF_RESUME==='1'){
 const prior=JSON.parse(await fs.readFile(`${output}/${suffix}-report.json`,'utf8'));
 // Older reports used the enclosing run journal for build provenance.
 const journal=prior.buildId?null:JSON.parse((await fs.readFile('.local/continuation-final-bloom-journal.json','utf8')).replace(/^\uFEFF/,''));
 const priorBuild=prior.buildId||(Array.isArray(journal)?journal.at(-1):journal)?.buildId;
 assert.equal(priorBuild,buildId,'Resume only completed scenarios from this exact production build');
 for(const key of ['baseline','matrix','engine','baseUrl','reducedMotion','requestedWorlds','requestedTiers'])assert.deepEqual(prior[key],report[key],`Resume must preserve ${key}`);
 const expected=worlds.flatMap(world=>tiers.map(tier=>({world,tier,reducedMotion})));
 assert.ok(prior.journeys.length<=expected.length);
 prior.journeys.forEach((entry,index)=>{for(const key of ['world','tier','reducedMotion'])assert.equal(entry[key],expected[index][key],'Resume preserves exact scenario order');assert.equal(entry.verifiedFiles,20);});
 report.journeys=prior.journeys;report.imageTrace=prior.imageTrace||[];
 report.resumedFrom={completed:prior.journeys.length,previousErrors:prior.errors||[],buildId};
}
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
let debugPage;

async function journey(world,tier){
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:reducedMotion?'reduce':'no-preference',serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');window.__bloomFrames=[];window.__bloomLongTasks=[];window.__bloomFramePrior=undefined;
  const frame=now=>{if(window.__bloomFramePrior!==undefined)window.__bloomFrames.push(now-window.__bloomFramePrior);window.__bloomFramePrior=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  try{if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__bloomLongTasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
 });
 const page=await context.newPage();debugPage=page;const errors=[],images=[],api=[],unexpected=[],revealed=new Set();let completed=false,releaseFinal,finalRequested=false;
 const finalGate=new Promise(resolve=>{releaseFinal=resolve;});
 const recap=()=>({...shell,worldId:world,completed,chapters:chapters.map(chapter=>revealed.has(chapter.id)?{...chapter,revealed:true}:{...chapter,stat:null,relatedRecording:null,recordings:undefined,revealed:false})});
 const prepared=()=>({story:recap(),chapters});
 const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:true,learnFromListening:false,reducedMotion,bloomPerformance:String(tier),onboarded:true,openingAnimation:0,timeZone:'Africa/Lagos',volume:0,seedArtists:[],seedGenres:[],shuffle:false,repeat:'off'};
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydration|hydrated|did not match|uncaught|minified react error/i.test(message.text()))errors.push(message.text());});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();api.push({path,method,prepared:url.searchParams.get('prepare')==='1'});
  if(path===`/api/v2/recordings/${recordings.at(-1).id}/audio`){const range=/bytes=(\d+)-(\d+)/.exec(request.headers().range||'');if(!range||Number(range[2])>=audio.length-1){finalRequested=true;await finalGate;}}
  if(await fixtureAudio(route))return;
  if(request.headers()['x-sakura-account']&&request.headers()['x-sakura-account']!==account.id){unexpected.push({path,method,reason:'Wrong account'});return route.fulfill({status:401,json:{error:'Account changed'}});}
  if(path==='/api/auth/session'&&method==='GET')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/settings'&&method==='GET')return route.fulfill({json:{...settings,revision:0,fieldRevisions:Object.fromEntries(Object.keys(settings).map(key=>[key,0]))}});
  if(path==='/api/v2/bootstrap'&&method==='GET')return route.fulfill({json:{profile:account}});
  if(path==='/api/v2/profile'&&method==='GET')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/library/state'&&method==='GET')return route.fulfill({json:{favoriteStates:{}}});
  if(path==='/api/v2/taste'&&method==='GET')return route.fulfill({json:{feedback:[],tasteEvidence:[],historyClearedAt:null}});
  if(path==='/api/v2/listening-session'&&method==='GET')return route.fulfill({json:{session:null,serverTime:Date.now()}});
  if(path==='/api/v2/library'&&method==='GET')return route.fulfill({json:{recordings:[],playlists:[],favoriteStates:{},hasMore:false,nextCursor:null}});
  if(path==='/api/v2/mixes'&&method==='GET')return route.fulfill({json:{mixes:[],items:[],hasMore:false,nextCursor:null}});
  if(path==='/api/v2/feed'&&method==='GET')return route.fulfill({json:{items:[],sections:[],nextCursor:null,personalized:true,totalCandidates:0,generatedAt:new Date().toISOString()}});
  if(path==='/api/v2/feed/hero'&&method==='GET')return route.fulfill({json:{item:null,refreshAt:Date.now()+600000}});
  if(path==='/api/v2/home'&&method==='GET')return route.fulfill({json:{featured:[],mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/image'&&method==='GET'){const image=url.searchParams.get('url');images.push(image);report.imageTrace??=[];report.imageTrace.push({world,tier,url:image,resourceType:request.resourceType()});return route.fulfill({headers:{'Cache-Control':'public,max-age=3600'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#7c9186"/><circle cx="285" cy="120" r="66" fill="#e6c49e"/></svg>'});}
  if(path===`/api/v2/bloom/${shell.id}/prepare`&&method==='POST')return route.fulfill({json:prepared()});
  if(path===`/api/v2/bloom/${shell.id}`&&method==='GET')return route.fulfill({json:url.searchParams.get('prepare')==='1'?prepared():recap()});
  if(path===`/api/v2/bloom/${shell.id}/reveal`&&method==='POST'){const id=request.postDataJSON().chapterId,index=chapters.findIndex(chapter=>chapter.id===id);assert.ok(index>=0);assert.ok(chapters.slice(0,index).every(chapter=>revealed.has(chapter.id)));revealed.add(id);return route.fulfill({json:recap()});}
  if(path===`/api/v2/bloom/${shell.id}/complete`&&method==='POST'){assert.equal(revealed.size,chapters.length);completed=true;return route.fulfill({json:recap()});}
  if(['/api/v2/bloom','/api/v2/bloom/shelf'].includes(path)&&method==='GET')return route.fulfill({json:{items:[{...shell,worldId:world}],schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/bloom/archive'&&method==='GET')return route.fulfill({json:{items:[]}});
  unexpected.push({path,method});return route.fulfill({status:503,json:{error:'Unexpected fixture request'}});
 });
 try{
  const openedAt=performance.now();await page.goto(`${base}/bloom/${shell.id}`,{waitUntil:'domcontentloaded',timeout:120000});
  const dialog=page.locator('dialog[open]'),begin=dialog.locator('[data-bloom-action="begin"]');await begin.waitFor();
  await expect.poll(()=>finalRequested).toBe(true);await expect(begin).toBeDisabled();assert.equal(revealed.size,0);
  releaseFinal();await expect(begin).toBeEnabled();await expect(dialog).toHaveAttribute('data-bloom-ready','true');if(tier!=='auto')await expect(dialog).toHaveAttribute('data-quality',String(tier));
  const initialQuality=Number(await dialog.getAttribute('data-quality'));assert.ok(initialQuality>=1&&initialQuality<=5);
  const verified=await page.evaluate(async({owner,ids})=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await Promise.all(ids.map(id=>new Promise((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(`account:${owner}:audio:${id}`);request.onsuccess=()=>resolve({id,size:request.result?.blob?.size,hash:request.result?.sha256,requested:request.result?.requested});request.onerror=()=>reject(request.error); })));}finally{db.close();}},{owner:account.id,ids:recordings.map(recording=>recording.id)});
  assert.equal(verified.length,20);assert.ok(verified.every(value=>value.size===audio.length&&value.hash===sha256&&value.requested===false),'All20full generated soundtrack files are verified before entry');
  const readyMs=performance.now()-openedAt,preparedImageRequests=images.length,preparedImageSources=new Set(images);
  if(!baseline)assert.equal(preparedImageRequests,20,'Preparation owns one image load for each concrete sleeve');
  await dialog.getByLabel('With music',{exact:true}).uncheck();await begin.click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: A listening chapter 1.');
  await dialog.locator(`[data-bloom-world="${world}"]`).waitFor();await page.waitForTimeout(2000);
  const preparationRequests=api.filter(value=>value.path===`/api/v2/bloom/${shell.id}/prepare`),detailRequests=api.filter(value=>value.path===`/api/v2/bloom/${shell.id}`);
  if(!baseline){assert.equal(detailRequests.length,1);assert.equal(detailRequests[0].prepared,true);assert.equal(preparationRequests.length,0,'Detail reuses its one authoritative prepared response');assert.equal(new Set(images).size,20);assert.ok(images.every(image=>image.includes('/640x640-')),'Phone DPR2 prepares640px display sleeves');const displayed=await dialog.locator('img').evaluateAll(nodes=>nodes.map(node=>new URL(node.currentSrc||node.src).searchParams.get('url')).filter(Boolean));assert.ok(displayed.length>0);assert.ok(displayed.every(image=>preparedImageSources.has(image)),'Displayed sleeves use an already prepared concrete source');}
  // Routing disables Chromium's native HTTP cache and this context blocks SW.
  // Separate DOM images can request identical prepared URLs again in this lab;
  // source equality is the contract, and all request attempts remain reported.
  const samplingStart=await page.evaluate(()=>{window.__bloomFrames=[];window.__bloomFramePrior=undefined;window.__bloomLongTasks=[];return performance.now();});await page.waitForTimeout(1500);
  const timing=await page.evaluate(start=>{const values=window.__bloomFrames.filter(value=>value>0&&value<1000).sort((a,b)=>a-b),tasks=window.__bloomLongTasks.filter(value=>value.start>=start);return {frames:{count:values.length,p50:values[Math.floor(values.length*.5)]??null,p95:values[Math.floor(values.length*.95)]??null,over50ms:values.filter(value=>value>50).length},longTasks:{count:tasks.length,totalMs:tasks.reduce((sum,value)=>sum+value.duration,0),maxMs:Math.max(0,...tasks.map(value=>value.duration))}};},samplingStart);
  const motion=await dialog.locator('[data-bloom-world]').evaluate(node=>{const animations=node.getAnimations({subtree:true}),running=animations.filter(animation=>animation.playState==='running');window.__bloomWorld=node;window.__bloomMotion=running.find(animation=>animation.effect?.getComputedTiming().iterations===Infinity)||running[0];return {running:running.length,paused:animations.filter(animation=>animation.playState==='paused').length,finished:animations.filter(animation=>animation.playState==='finished').length,infinite:animations.filter(animation=>animation.effect?.getComputedTiming().iterations===Infinity).length,total:animations.length,svgNodes:node.querySelectorAll('svg *').length,domNodes:node.querySelectorAll('*').length};});
  if(reducedMotion){await expect(dialog).toHaveAttribute('data-motion','still');assert.equal(motion.running,0,'Reduced motion stops authored world animation without changing selected quality');}
  let pause=null;
  if(tier===5&&!reducedMotion&&!motion.infinite){
   // China and Korea paint finite arrival movements, then rest. A finite
   // animation can finish during a button's actionability wait; its clock is
   // not a continuing-motion resume probe. Verify its final state directly.
   assert.ok(motion.total>0,'Maximum manual quality retains authored animation');
   await expect.poll(()=>page.evaluate(()=>{const animations=window.__bloomWorld.getAnimations({subtree:true});return animations.length>0&&animations.every(animation=>animation.playState==='finished');})).toBe(true);
   assert.equal(await page.evaluate(()=>window.__bloomWorld?.isConnected),true);
   pause={settledFinite:true,finishedAnimations:await page.evaluate(()=>window.__bloomWorld.getAnimations({subtree:true}).length)};
  }
  if(tier===5&&!reducedMotion&&motion.infinite){
   await dialog.getByRole('button',{name:'Play story',exact:true}).click();await dialog.getByRole('button',{name:'Pause story',exact:true}).click();await expect(dialog).toHaveAttribute('data-paused','true');
   await expect.poll(()=>page.evaluate(()=>window.__bloomMotion?.playState)).toBe('paused');
   await page.evaluate(async()=>{await window.__bloomMotion?.ready;});const pausedAt=await page.evaluate(()=>Number(window.__bloomMotion?.currentTime));await page.waitForTimeout(400);const heldAt=await page.evaluate(()=>Number(window.__bloomMotion?.currentTime));assert.ok(Math.abs(pausedAt-heldAt)<25);
   assert.equal(await page.evaluate(()=>window.__bloomWorld?.isConnected),true,'Pause keeps the original illustrated world');
   await dialog.getByRole('button',{name:'Play story',exact:true}).click();await expect(dialog).toHaveAttribute('data-paused','false');await expect.poll(()=>page.evaluate(()=>Number(window.__bloomMotion?.currentTime))).toBeGreaterThan(heldAt+100);
   pause={pausedAt,heldAt,resumedAt:await page.evaluate(()=>Number(window.__bloomMotion?.currentTime))};
  }
  if(tier!=='auto')await expect(dialog).toHaveAttribute('data-quality',String(tier));assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  const result={world,tier,reducedMotion,initialQuality,settledQuality:Number(await dialog.getAttribute('data-quality')),readyMs,verifiedFiles:verified.length,detailRequests:detailRequests.length,preparedDetailRequests:detailRequests.filter(value=>value.prepared).length,preparePosts:preparationRequests.length,preparedImageRequests,imageRequests:images.length,uniqueImages:new Set(images).size,imageWidths:[...new Set(images.map(image=>/\/(\d+)x\1-/.exec(image)?.[1]||'other'))],motion,...timing,pause};
  report.journeys.push(result);await fs.writeFile(`${output}/${suffix}-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(result));if(!matrix)await page.screenshot({path:`${output}/${suffix}-390.png`});
 }finally{releaseFinal();await context.close();}
}

try{const completed=report.journeys.length;let scenario=0;for(const world of worlds)for(const tier of tiers){if(scenario++<completed)continue;await journey(world,tier);}assert.equal(report.journeys.length,worlds.length*tiers.length);await fs.writeFile(`${output}/${suffix}-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({journeys:report.journeys.length,errors:report.errors}));}
catch(error){report.errors.push(error.message);if(debugPage&&!debugPage.isClosed())await debugPage.screenshot({path:`${output}/${suffix}-failed.png`}).catch(()=>{});await fs.writeFile(`${output}/${suffix}-report.json`,JSON.stringify(report,null,2));throw error;}
finally{await browser.close();}
