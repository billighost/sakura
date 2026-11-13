/** Real poster composition and serialized-clone geometry. Synthetic account;
 * every product API is intercepted. No real listener or live provider changes.
 */
import 'dotenv/config';
import {bloomAudioFixture} from './fixtures/bloom-audio.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';
import {buildBloomSnapshot,discloseBloomChapter} from '../src/rebuild/bloom/snapshot.ts';
import {bloomWindow} from '../src/rebuild/bloom/calendar.ts';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3014';
const baseline=process.env.SAKURA_EXPORT_BASELINE==='1';
const worlds=(process.env.SAKURA_EXPORT_WORLDS||'sakura,jungle,disco,japan,china,korea,india,ocean,cosmos,glass').split(',');
const widths=(process.env.SAKURA_EXPORT_WIDTHS||'1280,320').split(',').map(Number);
const variants=(process.env.SAKURA_EXPORT_VARIANTS||'rich,long,sparse,legacy').split(',');
const cancellationStages=(process.env.SAKURA_EXPORT_CANCEL_STAGES||'').split(',').filter(Boolean);
const output=`.local/bloom-export-review/${baseline?'before':'after'}`;await fs.mkdir(output,{recursive:true});
const account={id:'90000000-0000-4000-8000-000000000097',username:'Poster fixture',email:'poster@example.invalid'};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret);
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const period=bloomWindow('monthly-2026-10',new Date('2026-11-09T12:00:00Z'));
const cards=Array.from({length:6},(_,index)=>{const id=`80000000-0000-4000-8000-${String(index+297).padStart(12,'0')}`,artistId=`81000000-0000-4000-8000-${String(index<3?297:index+297).padStart(12,'0')}`,name=index<3?'宇多田ヒカル':['Tyler, The Creator','Burna Boy','Little Simz'][index-3],title=['One Last Kiss','Beautiful World','A Familiar Return','Another Listening Moment','A Collected Song','A New Recording'][index];return {id,recordingId:id,title,artists:[name],artistId,artistImageUrl:null,artistCredits:[{name,artistId,role:'primary'}],albumId:null,albumTitle:'Export fixture',coverUrl:'https://poster-fixture.invalid/cover.svg',durationMs:30000,metadata:{title,artists:[name],durationMs:30000,genres:['Pop'],version:{kinds:['original'],labels:[]}},reference:{provider:'deezer',id:String(index+297)},references:[{provider:'deezer',id:String(index+297)}],genres:['Pop'],playability:'resolvable',version:{kinds:['original'],labels:[]}};});
const rows=cards.map((card,index)=>({id:card.id,audible_ms:(6-index)*864000,plays:8-index,first_ever:index<3?'2026-09-10T08:00:00Z':'2026-10-08T12:00:00Z'}));
const rich=buildBloomSnapshot(rows,cards,19,period,{knownBeforeRecordingIds:cards.slice(0,3).map(card=>card.id),knownBeforeArtistKeys:[cards[0].artistId]});
const long=structuredClone(rich),longTitle='A Song with a Very Long Multilingual Title — 夜の庭と光 — Réflexions dans le jardin — An Extended Listening Recording',longArtist='A Long Artist Credit — 宇多田ヒカル — Les Musiciens du Courtyard';
for(const chapter of long.chapters){if(chapter.id==='top-song')chapter.stat.label=longTitle;if(chapter.id==='top-artist')chapter.stat.label=longArtist;for(const artist of chapter.artists||[])if(artist.key===cards[0].artistId)artist.name=longArtist;for(const entry of chapter.recordings||[])if(entry.recording.id===cards[0].id){entry.recording.title=longTitle;entry.recording.artists=[longArtist];entry.recording.metadata={...entry.recording.metadata,title:longTitle,artists:[longArtist]};}if(chapter.relatedRecording?.id===cards[0].id){chapter.relatedRecording.title=longTitle;chapter.relatedRecording.artists=[longArtist];}}
const sparse=buildBloomSnapshot([{id:cards[5].id,audible_ms:45000,plays:1,first_ever:null}],[{...cards[5],artistId:null,artistCredits:[],genres:[]}],1,period,{discoveryUnknownIds:[cards[5].id]});
const legacy={...rich,version:2,experience:undefined,listening:undefined};
const related={version:1,summary:{audibleMs:900000,playCount:12,recordingCount:1,activeDays:4},chapters:[{id:'top-song',kind:'song-winner',title:'A saved listening moment.',prompt:'',stat:{label:'One Last Kiss',value:'15min',unit:''},relatedRecording:cards[0]}]};
const report={scope:'Actual Next poster rendering and styled serialized SVG clone; signed synthetic account and authored SVG fixture artwork; all APIs intercepted.',baseline,journeys:[],cancellations:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});let debug;
async function journey(world,width,variant,cancelStage){
 const snapshot=({rich,long,sparse,legacy,related})[variant],recap={...period,...snapshot,worldId:world,status:'available',snapshotCreatedAt:variant==='legacy'||variant==='related'?undefined:'2026-11-09T12:00:00Z',completed:true,expiresAt:'2099-11-24T00:00:00+01:00',chapterCount:snapshot.chapters.length,chapters:snapshot.chapters.map(chapter=>discloseBloomChapter(chapter,true))};
 const context=await browser.newContext({viewport:{width,height:width<500?700:800},reducedMotion:'reduce',acceptDownloads:true,serviceWorkers:'block'});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(({owner,id,index})=>{
  sessionStorage.setItem('sakura-ink-opening','1');localStorage.setItem(`sakura-bloom-scene:${owner}:${id}`,JSON.stringify({index,version:3}));window.__posterGeometry=[];
  function geometry(root,phase){const box=root.getBoundingClientRect(),column=root.querySelector('.bloom-content'),relative=rect=>({x:rect.x-box.x,y:rect.y-box.y,width:rect.width,height:rect.height,right:rect.right-box.x,bottom:rect.bottom-box.y});return {phase,page:{width:box.width,height:box.height},column:relative(column.getBoundingClientRect()),text:[...column.querySelectorAll('h1,h2,p,small,strong,span')].filter(node=>node.textContent.trim()).map(node=>{const range=document.createRange();range.selectNodeContents(node);return {tag:node.tagName,text:node.textContent,box:relative(node.getBoundingClientRect()),ink:relative(range.getBoundingClientRect()),font:getComputedStyle(node).fontSize};}),images:[...column.querySelectorAll('img')].map(node=>({alt:node.alt,box:relative(node.getBoundingClientRect())})),scale:column.style.transform,worldHeight:root.querySelector('[data-view="poster"]')?.getBoundingClientRect().height};}
  const clone=Node.prototype.cloneNode;Node.prototype.cloneNode=function(deep){if(this instanceof Element&&this.hasAttribute('data-bloom-poster'))window.__posterGeometry.push(geometry(this,'rendered'));return clone.call(this,deep);};
  const serialize=XMLSerializer.prototype.serializeToString;XMLSerializer.prototype.serializeToString=function(node){if(node instanceof Element&&node.hasAttribute('data-bloom-poster')){const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;width:540px;height:960px;pointer-events:none';host.inert=true;host.setAttribute('aria-hidden','true');const copy=clone.call(node,true);host.append(copy);document.body.append(host);window.__posterGeometry.push(geometry(copy,'serialized'));host.remove();}return serialize.call(this,node);};
 },{owner:account.id,id:period.id,index:snapshot.chapters.length-1});
 const preparedAudio=bloomAudioFixture(cards);
 const page=await context.newPage();debug=page;page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydration|hydrated|did not match|uncaught|minified react error/i.test(message.text()))errors.push(message.text());});
 const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:true,learnFromListening:false,reducedMotion:true,bloomPerformance:'5',onboarded:true,openingAnimation:0,timeZone:'Africa/Lagos',volume:0,seedArtists:[],seedGenres:[],shuffle:false,repeat:'off'},unexpected=[];
 await context.route('**/api/**',async route=>{
  if(await preparedAudio(route))return;
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  if(request.headers()['x-sakura-account']&&request.headers()['x-sakura-account']!==account.id){unexpected.push({path,method,reason:'Wrong account'});return route.fulfill({status:401,json:{error:'Account changed'}});}
  if(path==='/api/auth/session'&&method==='GET')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/settings'&&method==='GET')return route.fulfill({json:{...settings,revision:0,fieldRevisions:Object.fromEntries(Object.keys(settings).map(key=>[key,0]))}});
  if(path==='/api/v2/library/state'&&method==='GET')return route.fulfill({json:{favoriteStates:{}}});
  if((path==='/api/v2/bootstrap'||path==='/api/v2/profile')&&method==='GET')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/taste'&&method==='GET')return route.fulfill({json:{feedback:[],tasteEvidence:[],historyClearedAt:null}});
  if(path==='/api/v2/listening-session'&&method==='GET')return route.fulfill({json:{session:null,serverTime:Date.now()}});
  if(path==='/api/v2/library'&&method==='GET')return route.fulfill({json:{recordings:[],playlists:[],favoriteStates:{},hasMore:false,nextCursor:null}});
  if(path==='/api/v2/mixes'&&method==='GET')return route.fulfill({json:{mixes:[],items:[],hasMore:false,nextCursor:null}});
  if(path==='/api/v2/feed'&&method==='GET')return route.fulfill({json:{items:[],sections:[],nextCursor:null,personalized:true,totalCandidates:0,generatedAt:new Date().toISOString()}});
  if(path==='/api/v2/feed/hero'&&method==='GET')return route.fulfill({json:{item:null,refreshAt:Date.now()+600000}});
  if(path==='/api/v2/home'&&method==='GET')return route.fulfill({json:{featured:[],mixes:[],recent:[],needsOnboarding:false}});
  if(path.startsWith('/api/v2/artists/')&&method==='GET'){
   const artistId=decodeURIComponent(path.slice('/api/v2/artists/'.length)),recordings=cards.filter(card=>card.artistId===artistId);
   if(recordings.length)return route.fulfill({json:{id:artistId,name:recordings[0].artists[0],imageUrl:null,recordings,tracks:recordings,albums:[]}});
  }
  if(path==='/api/v2/image'&&method==='GET')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#243851"/><circle cx="280" cy="125" r="110" fill="#e2b993"/><path d="M0 300Q140 105 400 320V400H0" fill="#889b8b"/></svg>'});
  if(path===`/api/v2/bloom/${period.id}/prepare`&&method==='POST'||path===`/api/v2/bloom/${period.id}`&&method==='GET'&&url.searchParams.get('prepare')==='1')return route.fulfill({json:{story:recap,chapters:snapshot.chapters,listening:snapshot.listening}});
  if(path===`/api/v2/bloom/${period.id}`&&method==='GET')return route.fulfill({json:recap});
  if([`/api/v2/bloom/${period.id}/reveal`,`/api/v2/bloom/${period.id}/complete`].includes(path)&&method==='POST')return route.fulfill({json:recap});
  if(path==='/api/v2/bloom'&&method==='GET')return route.fulfill({json:{items:[recap],schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/bloom/shelf'&&method==='GET')return route.fulfill({json:{items:[recap],schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/bloom/archive'&&method==='GET')return route.fulfill({json:{items:[]}});
  unexpected.push({path,method});return route.fulfill({status:503,json:{error:'Unexpected fixture request'}});
 });
 await page.goto(`${base}/bloom/${period.id}?world=${world}`,{waitUntil:'domcontentloaded',timeout:90000});const dialog=page.locator('dialog[open]');await dialog.locator(`[data-bloom-world="${world}"]`).waitFor();await expect(dialog.getByRole('combobox',{name:'Bloom world',exact:true})).toHaveCount(0);await dialog.getByLabel('With music',{exact:true}).uncheck();await dialog.locator('[data-bloom-action="begin"]').click();await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',/^Chapter 1:/);for(let index=0;index<snapshot.chapters.length;index++){await expect(dialog.locator('[data-bloom-action="next"]')).toBeEnabled();await dialog.locator('[data-bloom-action="next"]').click();if(index<snapshot.chapters.length-1)await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label',new RegExp(`^Chapter ${index+2}:`));}await dialog.locator('[data-bloom-action="save"]').waitFor();
 if(cancelStage){
  await cancelExport(page,dialog,cancelStage);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);await context.close();return;
 }
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),dialog.locator('[data-bloom-action="save"]').click()]);const path=`${output}/${world}-${variant}-${width}.png`;await download.saveAs(path);const png=await fs.readFile(path);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1920);assert.deepEqual(unexpected,[]);
 const geometry=await page.evaluate(()=>window.__posterGeometry);assert.equal(geometry.length,2,'The real composition and serialized clone are both measured');
 const clipping=geometry.flatMap(frame=>frame.text.flatMap(node=>node.box.x<-.5||node.box.right>540.5||node.box.y<-.5||node.box.bottom>960.5||node.ink.x<-.5||node.ink.right>540.5||node.ink.y<-.5||node.ink.bottom>960.5?[{phase:frame.phase,...node}]:[]));
 const result={world,width,variant,path,bytes:png.length,geometry,clipping};report.journeys.push(result);await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));if(!baseline)assert.deepEqual(clipping,[],`${world} ${variant} ${width}px exports every text line inside the page`);assert.deepEqual(errors,[]);
 if(variant==='long')for(const frame of geometry){assert.ok(frame.text.some(node=>node.text===longTitle));assert.ok(frame.text.some(node=>node.text===longArtist));}
 for(const frame of geometry){assert.ok(frame.text.some(node=>node.text.startsWith('sakura bloom ·')),'World credit and closing remain in the image');assert.ok(frame.images.length===1,'The winner artwork is retained');}
 await context.close();console.log(`Exported ${world} ${variant} ${width}px${clipping.length?' (clipped before fix)':''}`);
}
async function cancelExport(page,dialog,stage){
 assert.ok(['fonts','reader','decode','png'].includes(stage),'Unknown cancellation stage');
 await page.evaluate(stage=>{
  const probe=window.__exportCancellation={entered:false,images:[],readers:[],canvases:[],downloads:0};
  const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(...args){if(this.download)probe.downloads++;return click.apply(this,args);};
  if(stage==='fonts')Object.defineProperty(document.fonts,'ready',{configurable:true,get(){probe.entered=true;return new Promise(()=>{});}});
  if(stage==='reader')FileReader.prototype.readAsDataURL=function(){probe.readers.push(this);probe.entered=true;};
  if(stage==='decode'){const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.src.startsWith('data:image/svg+xml')){probe.images.push(this);probe.entered=true;return new Promise(()=>{});}return decode.call(this);};}
  if(stage==='png')HTMLCanvasElement.prototype.toBlob=function(){probe.canvases.push(this);probe.entered=true;};
 },stage);
 await dialog.locator('[data-bloom-action="save"]').click();await expect.poll(()=>page.evaluate(()=>window.__exportCancellation.entered)).toBe(true);
 const start=performance.now();await dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();
 let releasedWithinDeadline=true;
 try{await expect(page.locator('[data-bloom-poster]')).toHaveCount(0,{timeout:3000});}catch(error){if(!baseline)throw error;releasedWithinDeadline=false;}
 const resources=await page.evaluate(()=>{const probe=window.__exportCancellation;return {downloads:probe.downloads,imageSourceCharacters:probe.images.map(image=>image.getAttribute('src')?.length||0),readerHandlers:probe.readers.map(reader=>[reader.onload,reader.onerror,reader.onabort].some(Boolean)),canvasSizes:probe.canvases.map(canvas=>[canvas.width,canvas.height])};});
 assert.equal(resources.downloads,0);if(!baseline){assert.ok(resources.imageSourceCharacters.every(size=>size===0));assert.ok(resources.readerHandlers.every(attached=>!attached));assert.ok(resources.canvasSizes.every(([width,height])=>width===0&&height===0));}
 report.cancellations.push({stage,releasedWithinDeadline,remainingPosterRoots:await page.locator('[data-bloom-poster]').count(),closeToCleanupMs:releasedWithinDeadline?performance.now()-start:null,resources});await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(`Cancelled Bloom export during ${stage}; ${releasedWithinDeadline?'resource owners released':'baseline retains export beyond the 3s deadline'}`);
}
try{for(const width of widths)for(const variant of variants)for(const world of worlds)await journey(world,width,variant);if(!baseline&&variants.includes('legacy')&&worlds.includes('glass'))for(const world of ['japan','glass'].filter(world=>worlds.includes(world)))await journey(world,320,'related');for(const stage of cancellationStages)await journey(worlds[0],widths[0],'rich',stage);await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({exports:report.journeys.length,clipped:report.journeys.filter(journey=>journey.clipping.length).length,cancellations:report.cancellations.length,errors:report.errors}));}catch(error){report.errors.push(String(error));await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));if(debug&&!debug.isClosed())await debug.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
