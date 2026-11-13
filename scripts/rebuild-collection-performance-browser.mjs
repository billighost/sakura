/** Real production playlist; isolated synthetic APIs, streamed WAV, no database writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium, expect as playwrightExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=playwrightExpect.configure({timeout:30000});
const upstream=new URL(process.env.SAKURA_TEST_URL||'http://localhost:3117');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(upstream.hostname));
assert.equal(upstream.protocol,'http:');
const count=Number(process.env.SAKURA_COLLECTION_SIZE||1000);
assert.ok(Number.isInteger(count)&&count>=100&&count<=5000);
const label=(process.env.SAKURA_REPORT_LABEL||'current').replace(/[^a-z0-9_-]/gi,'_');
const expectNarrow=process.env.SAKURA_EXPECT_NARROW==='1';
const output=`.local/collection-performance-${label}.json`;
const account={id:'90000000-0000-4000-8000-000000000391',username:'Collection performance fixture',email:'collection-performance@example.invalid'};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const collectionId='90000000-0000-4000-8000-000000000392';
const rate=8000,samples=rate*180,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*900),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=Array.from({length:count},(_,i)=>{
 const id=`80000000-0000-4000-8000-${String(1000+i).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(1000+i).padStart(12,'0')}`;
 return {id,recordingId:id,title:`Canci\u00f3n ${String(i).padStart(4,'0')} \u590f\u306e\u97f3\u697d${i%10===0?' beacon':''}`,artists:['Beyonc\u00e9','\u6b4c\u624b'],artistCredits:[{name:'Featured voice',role:'featured',artistId:null}],artistsComplete:true,albumTitle:'\u590f\u306e\u5ead / The summer garden',alternateTitles:['\ubcc4\ube5b'],durationMs:180000,versionLabel:'Original recording',coverUrl:null,albumId:null,artistId:null,addedAt:new Date(Date.UTC(2026,0,1)+(i*60000)).toISOString(),reference:{provider:'deezer',id:String(i+1000)},references:[{provider:'deezer',id:String(i+1000)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:180000,url:`https://res.cloudinary.com/collection-performance-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const settings={theme:'light',audioQuality:'data-saver',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.3,shuffle:false,repeat:'off'};
const revisions=Object.fromEntries(Object.keys(settings).map(key=>[key,0]));
let settingsRevision=0,session=null,base,server,browser,page,streamDelay=45;
const favoriteStates={};
const collectionViews=new Map();
const flights=new Set();
const report={checkedAt:new Date().toISOString(),upstream:upstream.origin,collectionSize:count,scope:'Production playlist UI with an isolated local fixture proxy, generated real WAV and browser-only storage; every API is synthetic and mutations never reach the application server',limitations:['Chromium mobile emulation is not physical mobile hardware','Fiber changed-host-prop counters are diagnostic instrumentation, not React render durations','Proxy buffers HTML/RSC; absolute startup times include that harness cost','Fiber traversal is disabled for input and scrolling measurements'],checks:[],requests:[],unexpectedMutations:[],pageErrors:[],measurements:{},proxyErrors:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function json(response,value,status=200){const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json','Content-Length':String(bytes.length),'Cache-Control':'no-store'});response.end(bytes);}
async function body(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;assert.ok(size<=1024*1024);chunks.push(chunk);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}
async function audio(request,response,index){
 const range=String(request.headers.range||'').match(/bytes=(\d+)-(\d*)/);
 const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
 if(start>=wav.length){response.writeHead(416,{'Content-Range':`bytes */${wav.length}`});response.end();return;}
 const headers={'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
 if(range)headers['Content-Range']=`bytes ${start}-${end}/${wav.length}`;
 report.requests.push({kind:'audio',index,start,end,method:request.method,at:Date.now()});
 response.writeHead(range?206:200,headers);
 if(request.method==='HEAD'){response.end();return;}
 for(let offset=start;offset<=end&&!response.destroyed;offset+=32768){response.write(wav.subarray(offset,Math.min(offset+32768,end+1)));if(streamDelay)await sleep(streamDelay);}
 if(!response.destroyed)response.end();
}
async function api(request,response,url){
 const path=url.pathname,method=request.method||'GET';
 report.requests.push({path,method,at:Date.now()});
 if(request.headers['x-sakura-account']&&request.headers['x-sakura-account']!==account.id)return json(response,{error:'Account changed'},401);
 const audioMatch=path.match(/^\/api\/v2\/recordings\/([^/]+)\/audio$/);
 if(audioMatch)return audio(request,response,tracks.findIndex(track=>track.id===audioMatch[1]));
 if(path==='/api/auth/session')return json(response,{user:account});
 if(path==='/api/v2/profile'||path==='/api/v2/bootstrap')return json(response,{profile:account,stats:{},topArtists:[]});
 if(path==='/api/v2/settings'){
  if(method==='PATCH'){const {expectedRevision,...patch}=await body(request);if(expectedRevision!==undefined&&expectedRevision!==settingsRevision)return json(response,{error:'Settings changed'},409);Object.assign(settings,patch);settingsRevision++;for(const key of Object.keys(patch))revisions[key]=settingsRevision;}
  return json(response,{...settings,revision:settingsRevision,fieldRevisions:revisions});
 }
 if(path==='/api/v2/library/state')return json(response,{favoriteStates});
 if(path==='/api/v2/collection-view'){
  if(method==='PATCH'){
   const input=await body(request),preference={layout:input.layout,sort:input.sort,direction:input.direction,updatedAt:new Date().toISOString()};
   collectionViews.set(String(input.room),preference);return json(response,{room:input.room,preference});
  }
  const room=url.searchParams.get('room');return json(response,{room,preference:collectionViews.get(String(room))||null});
 }
 if(path==='/api/v2/library'){
  if(method==='POST'){const input=await body(request),id=input.recordingId;if(!tracks.some(track=>track.id===id))return json(response,{error:'Unknown synthetic recording'},400);const revision=(favoriteStates[id]?.revision||0)+1;favoriteStates[id]={liked:Boolean(input.liked),revision,updatedAt:Date.now()};return json(response,{recordingId:id,operationId:input.operationId,accepted:true,...favoriteStates[id]});}
  return json(response,{recordings:tracks.filter(track=>favoriteStates[track.id]?.liked),playlists:[],nextCursor:null});
 }
 if(path===`/api/v2/playlists/${collectionId}`)return json(response,{id:collectionId,name:'A thousand songs, close at hand',description:'Large mixed-script performance fixture',recordings:tracks,playability:'ready',revision:1});
 if(path==='/api/v2/listening-session'){
  if(method==='PUT'){const input=await body(request);if(input.revision!==(session?.revision||0))return json(response,{accepted:false,session,serverTime:Date.now()});session={state:input.state,revision:input.revision+1,deviceId:input.deviceId,updatedAt:Date.now()};return json(response,{accepted:true,session,serverTime:Date.now()});}
  return json(response,{session,serverTime:Date.now()});
 }
 if(path==='/api/v2/recordings/resolve'){const input=await body(request),track=tracks.find(track=>track.reference.id===input.reference?.id)||tracks[0];return json(response,{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback});}
 if(path==='/api/v2/lyrics')return json(response,{status:'found',timing:'synced',schemaVersion:'verified-lyrics-v3',provider:'fixture',providerTrackId:1,lines:Array.from({length:30},(_,i)=>({start:i*5,end:(i+1)*5,text:'Fixture lyric '+i})),syncRevision:0});
 if(path==='/api/v2/smart-queue')return json(response,{tracks:[]});
 if(path==='/api/v2/home')return json(response,{featured:tracks.slice(0,4),mixes:[],recent:[],needsOnboarding:false});
 if(path.startsWith('/api/v2/feed'))return json(response,path.endsWith('/hero')?{item:{track:tracks[0],lane:'similar',reason:'Fixture'}}:{items:[],sections:[],nextCursor:null});
 if(path==='/api/v2/favorites'){
  const input=await body(request),id=input.recordingId;
  if(!tracks.some(track=>track.id===id))return json(response,{error:'Unknown synthetic recording'},400);
  const revision=(favoriteStates[id]?.revision||0)+1;favoriteStates[id]={liked:Boolean(input.liked),revision,updatedAt:Date.now()};
  return json(response,{recordingId:id,...favoriteStates[id]});
 }
 if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return json(response,{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]});
 if(!['GET','HEAD'].includes(method)){report.unexpectedMutations.push({path,method});return json(response,{error:'Unexpected fixture mutation'},503);}
 return json(response,{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}});
}
async function startProxy(){
 server=createServer(async(request,response)=>{
  try{
   const url=new URL(request.url,'http://localhost');let path=url.pathname;
   for(let i=0;i<3;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
   if(/^\/api(?:\/|$)/.test(new URL(path,upstream.origin).pathname))return await api(request,response,url);
   if(!['GET','HEAD'].includes(request.method||'GET'))return json(response,{error:'Proxy only forwards reads'},405);
   const controller=new AbortController();flights.add(controller);response.once('close',()=>{if(!response.writableEnded)controller.abort();});
   try{
    const headers=new Headers();for(const [key,value] of Object.entries(request.headers))if(value!==undefined&&!['host','connection','content-length','accept-encoding','transfer-encoding'].includes(key))headers.set(key,Array.isArray(value)?value.join(', '):value);headers.set('accept-encoding','identity');
    const upstreamResponse=await fetch(new URL(url.pathname+url.search,upstream.origin),{method:request.method,headers,redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
    const forwarded={};upstreamResponse.headers.forEach((value,key)=>{if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(key))forwarded[key]=value;});
    if(forwarded.location){const target=new URL(forwarded.location,upstream.origin);assert.equal(target.origin,upstream.origin);forwarded.location=base+target.pathname+target.search;}
    const bytes=Buffer.from(await upstreamResponse.arrayBuffer());response.writeHead(upstreamResponse.status,forwarded);response.end(request.method==='HEAD'?undefined:bytes);
   }finally{flights.delete(controller);}
  }catch(error){if(!response.destroyed&&!response.writableEnded){report.proxyErrors.push(String(error));if(!response.headersSent)response.writeHead(502);response.end();}}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base='http://127.0.0.1:'+server.address().port;report.proxyOrigin=base;
}
function instrument(){
 sessionStorage.setItem('sakura-ink-opening','1');
 const state=window.collectionProbe={enabled:true,commits:[],events:[],longTasks:[],frameGaps:[],listeners:{},gestureDeletes:0};
 const listenerRecords=new WeakMap(),nativeAdd=EventTarget.prototype.addEventListener,nativeRemove=EventTarget.prototype.removeEventListener;
 const watched=new Set(['scroll','blur','visibilitychange','pointerdown']);
 function label(target,type,capture){return (target===document?'document':'window')+':'+type+':'+(capture?'capture':'bubble');}
 EventTarget.prototype.addEventListener=function(type,listener,options){
  if((this===document||this===window)&&watched.has(type)&&listener){const capture=typeof options==='boolean'?options:Boolean(options?.capture),key=label(this,type,capture);let records=listenerRecords.get(listener);if(!records)listenerRecords.set(listener,records=new Set());if(!records.has(key)){records.add(key);state.listeners[key]=(state.listeners[key]||0)+1;}}
  return nativeAdd.call(this,type,listener,options);
 };
 EventTarget.prototype.removeEventListener=function(type,listener,options){
  if((this===document||this===window)&&watched.has(type)&&listener){const capture=typeof options==='boolean'?options:Boolean(options?.capture),key=label(this,type,capture),records=listenerRecords.get(listener);if(records?.delete(key))state.listeners[key]=Math.max(0,(state.listeners[key]||0)-1);}
  return nativeRemove.call(this,type,listener,options);
 };
 let renderer=0;
 window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return ++renderer;},onCommitFiberUnmount(){},onCommitFiberRoot(_renderer,root){
  if(!state.enabled)return;
  const started=performance.now(),stack=[root.current];let rows=0,changedRows=0,changedNonPlayingRows=0,identityUpdates=0;
  while(stack.length){const fiber=stack.pop();if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);const props=fiber.memoizedProps;if(typeof fiber.type==='string'&&props){if(props['data-song-id']){rows++;if(fiber.alternate&&fiber.alternate.memoizedProps!==props){changedRows++;if(!String(props.className||'').includes('current'))changedNonPlayingRows++;}}if(props['aria-label']==='Open now playing'&&fiber.alternate&&fiber.alternate.memoizedProps!==props)identityUpdates++;}}
  state.commits.push({at:started,rows,changedRows,changedNonPlayingRows,identityUpdates,instrumentationMs:performance.now()-started});
 }};
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())state.longTasks.push({at:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
 nativeAdd.call(document,'input',event=>{const started=performance.now();requestAnimationFrame(()=>state.events.push({value:event.target.value,at:started,nextFrameMs:performance.now()-started}));},true);
 const NativeAudio=window.Audio;window.Audio=function(...args){const media=new NativeAudio(...args);window.collectionAudio=media;return media;};window.Audio.prototype=NativeAudio.prototype;
}
function summarize(commits){return {commits:commits.length,changedRowPropObjects:commits.reduce((sum,row)=>sum+row.changedRows,0),changedOtherRowPropObjects:commits.reduce((sum,row)=>sum+row.changedNonPlayingRows,0),identityPropUpdates:commits.reduce((sum,row)=>sum+row.identityUpdates,0),instrumentationMs:commits.reduce((sum,row)=>sum+row.instrumentationMs,0),maxRowsPerCommit:Math.max(0,...commits.map(row=>row.changedRows))};}
function percentile(values,fraction){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))];}
try{
 await startProxy();browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);await context.addInitScript(instrument);
 await context.route('https://res.cloudinary.com/collection-performance-fixture/**',route=>route.fulfill({status:307,headers:{Location:base+'/api/v2/recordings/'+tracks.find(track=>route.request().url()===track.readyPlayback.url).id+'/audio','Access-Control-Allow-Origin':'*'}}));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base||url.protocol==='data:'||url.hostname==='res.cloudinary.com')return route.fallback();return route.abort();});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 const started=performance.now();await page.goto(base+'/playlist/'+collectionId,{waitUntil:'domcontentloaded',timeout:90000});
 const rows=page.locator('[data-track-layout] [data-song-id]');await expect(rows).toHaveCount(count);
 report.measurements.coldPlaylistVisibleMs=performance.now()-started;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 report.measurements.idleListeners=await page.evaluate(()=>window.collectionProbe.listeners);
 report.measurements.mountedDomElements=await page.locator('*').count();
 report.checks.push(`${count} mixed-script rows render on the actual mobile playlist`);
 await rows.nth(0).getByRole('button',{name:'Play '+tracks[0].title,exact:true}).tap();
 await expect.poll(()=>page.evaluate(()=>window.collectionAudio?.currentTime>.2&&!window.collectionAudio.paused)).toBe(true);
 await page.evaluate(()=>{window.collectionProbe.commits=[];});
 await page.waitForTimeout(1600);
 report.measurements.playbackOnly=summarize(await page.evaluate(()=>window.collectionProbe.commits));
 for(const i of [1,2,3,4])await rows.nth(i).getByRole('button',{name:'Download '+tracks[i].title,exact:true}).tap();
 await expect.poll(()=>rows.locator('[role="progressbar"]').count()).toBeGreaterThan(0);
 await page.evaluate(()=>{window.collectionProbe.commits=[];});
 await page.waitForTimeout(2200);
 const transferSnapshot=await page.evaluate(()=>({commits:window.collectionProbe.commits,progress:[...document.querySelectorAll('[role="progressbar"]')].map(node=>({label:node.getAttribute('aria-label'),value:node.getAttribute('aria-valuenow')})),audio:{time:window.collectionAudio?.currentTime,paused:window.collectionAudio?.paused}}));
 report.measurements.fourDownloads=summarize(transferSnapshot.commits);report.measurements.progressDuringDownloads=transferSnapshot.progress;
 if(expectNarrow){
  assert.ok(report.measurements.playbackOnly.maxRowsPerCommit<count/2,'Playback ticks must not change every collection row');
  assert.ok(report.measurements.fourDownloads.maxRowsPerCommit<count/2,'Download progress must remain local to affected rows');
  assert.ok((report.measurements.idleListeners['window:blur:bubble']||0)<50,'Idle rows must not register global hold listeners');
 }
 assert.equal(transferSnapshot.audio.paused,false);assert.ok(transferSnapshot.audio.time>1);
 report.checks.push('Four explicit downloads stream while the original song remains audible');
 // Avoid attributing Fiber traversal cost to input/scrolling.
 await page.evaluate(()=>{window.collectionProbe.enabled=false;window.collectionProbe.events=[];window.collectionProbe.longTasks=[];});
 const search=page.getByRole('searchbox',{name:'Find a song in this playlist',exact:true});
 async function searchSample(query,expected,name){
  await search.fill('');await expect(rows).toHaveCount(count);
  const before=performance.now();await search.fill(query);await expect(rows).toHaveCount(expected);
  await expect(page.getByRole('status').filter({hasText:'Searching songs'})).toHaveCount(0);
  const settled=performance.now()-before;
  report.measurements.searchSamples??=[];report.measurements.searchSamples.push({name,query,settledMs:settled,expectedRows:expected});
 }
 await searchSample('beacon',Math.ceil(count/10),'first index construction and subset paint');
 await searchSample('cancion beyonce',count,'warm accent folding, all rows');
 await searchSample('\u6b4c\u624b \u590f',count,'warm Japanese query');
 await searchSample('featured beacon',Math.ceil(count/10),'warm featured artist and title');
 await search.fill('');await expect(rows).toHaveCount(count);await search.focus();
 const client=await context.newCDPSession(page);
 await client.send('Input.imeSetComposition',{text:'\u590f\u306e',selectionStart:2,selectionEnd:2});
 await client.send('Input.insertText',{text:'\u590f\u306e'});await expect(search).toHaveValue('\u590f\u306e');await expect(rows).toHaveCount(count);
 await search.press('Escape');await expect(search).toHaveValue('');await expect(rows).toHaveCount(count);await client.detach();
 await search.fill('beacon');await search.fill('unmatched latest query');await expect(rows).toHaveCount(0);await search.fill('');await expect(rows).toHaveCount(count);
 const inputSamples=await page.evaluate(()=>window.collectionProbe.events);
 report.measurements.inputToNextFrame={samples:inputSamples,p95Ms:percentile(inputSamples.map(event=>event.nextFrameMs),.95)};
 report.checks.push('Latin accent folding, Japanese, featured credits, IME, Escape clear and rapid stale-search cancellation preserve expected membership');
 const sort=page.getByRole('combobox',{name:'Sort songs',exact:true});
 async function selectSort(value){if(await sort.evaluate(node=>node.tagName==='SELECT'))await sort.selectOption(value);else{await sort.tap();await page.getByRole('option',{name:value==='title'?'Song title':'Playlist order',exact:true}).tap();}}
 await selectSort('title');
 await page.getByRole('button',{name:'Reverse sort order',exact:true}).tap();await expect(rows.first()).toHaveAttribute('data-song-id',tracks.at(-1).id);
 await page.getByRole('button',{name:'Reverse sort order',exact:true}).tap();await selectSort('kept');await expect(rows.first()).toHaveAttribute('data-song-id',tracks[0].id);
 report.checks.push('Sorting and reversal retain exact row identities and collection order');
 const gestureRow=page.locator(`[data-track-layout] [data-song-id="${tracks[7].id}"]`);
 const button=gestureRow.getByRole('button',{name:'Play '+tracks[7].title,exact:true});await button.scrollIntoViewIfNeeded();await button.focus();await button.press('Shift+F10');await expect(page.getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);
 const holdTarget=gestureRow.locator('[data-track-credits]');await holdTarget.dispatchEvent('pointerdown',{pointerId:11,pointerType:'touch',isPrimary:true,button:0,clientX:80,clientY:200});
 report.measurements.holdListeners=await page.evaluate(()=>({...window.collectionProbe.listeners}));
 await page.locator('#music-main').dispatchEvent('scroll');await expect(gestureRow).not.toHaveAttribute('data-press-phase','pending');
 await page.waitForTimeout(520);await expect(page.getByRole('menu')).toHaveCount(0);
 report.measurements.afterCancelledHoldListeners=await page.evaluate(()=>({...window.collectionProbe.listeners}));
 if(expectNarrow){
  // A concurrently settling menu may also release its own listener. Assert
  // each listener owned by this hold rather than the entire page's net total.
  for(const key of ['document:scroll:capture','window:blur:bubble','document:visibilitychange:bubble','document:pointerdown:capture'])
   assert.equal((report.measurements.holdListeners[key]||0)-(report.measurements.afterCancelledHoldListeners[key]||0),1,'An active touch hold releases its '+key+' listener');
 }
 report.checks.push('Keyboard song options remain usable; scrolling cancels touch holds and removes hold listeners');
 await page.evaluate(async()=>{
  window.collectionProbe.events=[];window.collectionProbe.longTasks=[];
  // The preceding keyboard menu leaves its trigger focused. Settle that
  // interaction before measuring ordinary stage scrolling and its geometry.
  document.querySelector('#music-main')?.focus({preventScroll:true});
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
 report.measurements.scrolling=await page.locator('#music-main').evaluate(async node=>{
  node.scrollTop=0;const gaps=[],adjustments=[];let previous=performance.now();
  for(let i=0;i<100;i++){const target=Math.min(node.scrollHeight-node.clientHeight-1,node.scrollTop+220);node.scrollTop=target;await new Promise(resolve=>requestAnimationFrame(resolve));const now=performance.now();gaps.push(now-previous);previous=now;adjustments.push(node.scrollTop-target);}
  return {frameGaps:gaps,maxScrollAdjustment:Math.max(...adjustments.map(Math.abs)),horizontalOverflow:node.scrollWidth-node.clientWidth};
 });
 report.measurements.scrolling.p95FrameGapMs=percentile(report.measurements.scrolling.frameGaps,.95);
 assert.ok(report.measurements.scrolling.maxScrollAdjustment<=2);assert.ok(report.measurements.scrolling.horizontalOverflow<=1);
 report.checks.push('The large mobile playlist scrolls without offset jumps or horizontal overflow');
 const probe=await page.evaluate(()=>window.collectionProbe);
 report.measurements.scrollLongTasks=probe.longTasks;
 report.measurements.finalListeners=probe.listeners;
 report.measurements.scriptBytes=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.initiatorType==='script').reduce((sum,entry)=>sum+entry.decodedBodySize,0));
 assert.ok(report.requests.some(request=>request.kind==='audio'&&request.end>request.start));assert.deepEqual(report.unexpectedMutations,[]);assert.deepEqual(report.pageErrors,[]);
}catch(error){report.error=error.stack||String(error);process.exitCode=1;report.failure=await page?.evaluate(()=>({path:location.pathname,text:document.body.innerText.slice(-8000),audio:{src:window.collectionAudio?.src,time:window.collectionAudio?.currentTime,paused:window.collectionAudio?.paused},probe:window.collectionProbe})).catch(()=>null);}
finally{
 await browser?.close();for(const flight of flights)flight.abort();if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 await fs.mkdir('.local',{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({report:output,checks:report.checks,measurements:report.measurements,error:report.error||null,pageErrors:report.pageErrors}));
}
