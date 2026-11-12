/** Real MusicProvider/Chrome startup races and slow progressive audio; synthetic account APIs only. */
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit,expect as playwrightExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const upstream=new URL(process.env.SAKURA_TEST_URL||'http://localhost:3017');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(upstream.hostname),'Fixture upstream must be local');
const expect=playwrightExpect.configure({timeout:45000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000099',username:'Startup audit',email:'startup@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const recordingId='80000000-0000-4000-8000-000000000099',assetId='81000000-0000-4000-8000-000000000099';
const track={id:recordingId,recordingId,title:'Startup race fixture',artists:['Audit Ensemble'],artistsComplete:true,durationMs:180000,reference:{provider:'deezer',id:'99'},references:[{provider:'deezer',id:'99'}]};
const nextTrack={...track,id:'80000000-0000-4000-8000-000000000098',recordingId:'80000000-0000-4000-8000-000000000098',title:'The next lyric fixture',reference:{provider:'deezer',id:'98'},references:[{provider:'deezer',id:'98'}]};
const rate=8000,samples=rate*180;
let wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*400),44+i*2);
if(process.env.SAKURA_AUDIO_FIXTURE)wav=await readFile(process.env.SAKURA_AUDIO_FIXTURE);
const mimeType=process.env.SAKURA_AUDIO_FIXTURE?'audio/mpeg':'audio/wav',extension=mimeType==='audio/mpeg'?'mp3':'wav';
const sha256=createHash('sha256').update(wav).digest('hex');
const fallbackUrl=`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`;
const ready={kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256,mimeType,durationMs:track.durationMs,url:`https://res.cloudinary.com/startup-audit-fixture/video/upload/v1/sakura/v2/audio/${recordingId}/${sha256}.${extension}`,fallbackUrl};
const settings={theme:'light',audioQuality:'data-saver',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],volume:.3,shuffle:false,repeat:'off'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={scope:'Actual Next MusicProvider, browser media element and production service worker with generated WAV, synthetic authenticated APIs and browser-only storage; no server database writes',checks:[],scenarios:[],pageErrors:[],blockedWrites:[],apiRequests:[],mediaResponses:[],browserConsole:[],requestFailures:[]};
let scenario='fallback-race',session=null,base;
const ranges=[];
const flights=new Set();
const sockets=new Set();
function json(response,value,status=200){response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));}
async function bytes(request,response,delay=0,slowBody=false){
 const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'');
 const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(wav.length-1,Number(match[2])):wav.length-1;
 if(start>=wav.length||end<start){response.writeHead(416,{'Content-Range':`bytes */${wav.length}`});response.end();return;}
 const row={scenario,start,end,startedAt:Date.now(),finished:false,media:request.headers['sec-fetch-dest']==='audio'};ranges.push(row);
 const headers={'Content-Type':mimeType,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','ETag':'"'+sha256+'"'};
 if(match)headers['Content-Range']=`bytes ${start}-${end}/${wav.length}`;
 if(!slowBody&&delay)await pause(delay);
 if(response.destroyed)return;
 response.writeHead(match?206:200,headers);
 const body=wav.subarray(start,end+1);
 if(slowBody){response.write(body.subarray(0,64));await pause(delay);if(response.destroyed)return;response.end(body.subarray(64));}
 else response.end(body);
 row.finished=true;row.finishedAt=Date.now();
}
const proxy=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,base||'http://localhost');let path=url.pathname;
  for(let i=0;i<3;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}
  path=new URL(path,upstream).pathname;
  const method=request.method||'GET';
  if(path==='/fixture-first.wav'){response.writeHead(503,{'Content-Type':'text/plain'});response.end('Temporarily unavailable');return;}
  if(path==='/fixture-fallback.wav'){await bytes(request,response,750);return;}
  if(path==='/fixture-direct.wav'){await bytes(request,response);return;}
  // Development diagnostics use a POST-shaped read. Keep that entirely within
  // the fixture instead of forwarding it to the project server.
  if(path==='/__nextjs_original-stack-frames'){json(response,{frames:[]});return;}
  if(/^\/api(?:\/|$)/.test(path)){
   report.apiRequests.push({path,method,scenario});
   const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;assert.ok(length<1024*1024);chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8'),input=text?JSON.parse(text):{};
   if(/\/recordings\/[^/]+\/audio$/.test(path)){await bytes(request,response,scenario==='restored-download'?20000:scenario==='slow-progressive'?(request.headers.range?.startsWith('bytes=0-')?14000:4500):0,scenario==='slow-progressive');return;}
   if(path==='/api/auth/session'){json(response,{user:account});return;}
   if(path==='/api/v2/library/state'){json(response,{favoriteStates:{}});return;}if((path==='/api/v2/bootstrap'||path==='/api/v2/profile')){json(response,{profile:account,stats:{},topArtists:[]});return;}
   if(path==='/api/v2/settings'){json(response,settings);return;}
   if(path==='/api/v2/library'){json(response,{recordings:scenario==='lyrics-change'?[track,nextTrack]:[scenario==='slow-progressive'?{...track,readyPlayback:ready}:track],playlists:[]});return;}
   if(path==='/api/v2/listening-session'){
    if(method==='PUT'){session={state:input.state,revision:input.revision+1,deviceId:input.deviceId,updatedAt:Date.now()};json(response,{accepted:true,session,serverTime:Date.now()});}
    else json(response,{session,serverTime:Date.now()});return;
   }
   if(path==='/api/v2/recordings/resolve'){if(scenario==='restored-download'){json(response,{error:'Fixture connection interrupted'},503);return;}const subject=input.reference?.id==='98'?nextTrack:track;json(response,{status:'resolved',recording:{...subject,metadata:{title:subject.title,artists:subject.artists,artistsComplete:true,durationMs:subject.durationMs}},playback:scenario==='fallback-race'?{url:'/fixture-first.wav',fallbackUrl:'/fixture-fallback.wav',assetId:'fixture',sizeBytes:wav.length}:['promise-failure','lyrics-change','mobile-nav'].includes(scenario)?{url:'/fixture-direct.wav',assetId:'fixture',sizeBytes:wav.length}:ready});return;}
   if(path==='/api/v2/lyrics'){if(scenario==='lyrics-change'){const next=url.searchParams.get('title')===nextTrack.title;if(next)await pause(650);json(response,{status:'matched',provider:'generated fixture',timing:'synced',lines:Array.from({length:next?80:100},(_,i)=>({start:i*2,end:(i+1)*2,text:(next?'Next song':'First song')+' words '+i}))});}else json(response,{lines:[],timing:'unsynced',status:'unavailable'});return;}
   if(!['GET','HEAD'].includes(method)){report.blockedWrites.push({path,method});json(response,{error:'Unexpected synthetic mutation'},503);return;}
   json(response,{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}});return;
  }
  if(!['GET','HEAD'].includes(method)){report.blockedWrites.push({path,method});json(response,{error:'Read-only fixture boundary'},405);return;}
  const controller=new AbortController();flights.add(controller);response.on('close',()=>{if(!response.writableEnded)controller.abort();});
  try{
   const headers=new Headers();for(const[name,value]of Object.entries(request.headers)){if(value!==undefined&&!['host','connection','content-length','accept-encoding','transfer-encoding','upgrade','keep-alive'].includes(name))headers.set(name,Array.isArray(value)?value.join(', '):value);}headers.set('accept-encoding','identity');
   const result=await fetch(new URL(url.pathname+url.search,upstream),{method,headers,redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
   const forwarded={};result.headers.forEach((value,name)=>{if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(name))forwarded[name]=value;});
   if(forwarded.location){const location=new URL(forwarded.location,upstream);assert.equal(location.origin,upstream.origin);forwarded.location=new URL(location.pathname+location.search,base).href;}
   let body=Buffer.from(await result.arrayBuffer());
   if(path==='/sw.js'&&process.env.SAKURA_AUDIO_DIAGNOSTICS==='1')body=Buffer.from(body.toString('utf8')+`\nconst fixtureServe=serveDeviceAudio;serveDeviceAudio=async(request,clientId,token)=>{const response=await fixtureServe(request,clientId,token);for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'fixture-audio-range',clientId,range:request.headers.get('Range'),status:response.status});return response;};\n`);
   forwarded['Content-Length']=String(body.length);response.writeHead(result.status,forwarded);response.end(method==='HEAD'?undefined:body);
  }finally{flights.delete(controller);}
 }catch{if(!response.destroyed){if(!response.headersSent)response.writeHead(502);response.end();}}
});
// Next dev waits for its HMR socket before hydration; preserve the local socket
// when this test runs against development rather than a production build.
proxy.on('upgrade',(request,socket,head)=>{
 if(!request.url?.startsWith('/_next/hmr')){socket.destroy();return;}
 const connection=httpRequest(new URL(request.url,upstream),{headers:{...request.headers,host:upstream.host,origin:upstream.origin}});
 connection.on('upgrade',(response,peer,peerHead)=>{sockets.add(socket);sockets.add(peer);socket.on('close',()=>sockets.delete(socket));peer.on('close',()=>sockets.delete(peer));socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');if(peerHead.length)socket.write(peerHead);if(head.length)peer.write(head);socket.pipe(peer);peer.pipe(socket);});
 connection.on('response',response=>{socket.end('HTTP/1.1 '+response.statusCode+' Rejected\r\n\r\n');response.resume();});connection.on('error',()=>socket.destroy());connection.end();
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+proxy.address().port;
await mkdir('.local',{recursive:true});
const browserName=process.env.SAKURA_TEST_BROWSER||'chrome';
const browser=browserName==='webkit'?null:await chromium.launch({channel:'chrome',headless:true});
async function open(mode){
 scenario=mode;session=null;
 const contextOptions={viewport:{width:320,height:568},isMobile:true,hasTouch:true,serviceWorkers:['slow-progressive','restored-download'].includes(mode)?'allow':'block'};
 // The Windows WebKit port cannot persist Blob data in ephemeral contexts.
 // Keep this generated fixture's storage in its own private, persistent profile.
 const context=browser?await browser.newContext(contextOptions):await webkit.launchPersistentContext('.local/webkit-startup-'+mode+'-'+process.pid,{...contextOptions,headless:true});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(mode=>{
  try{sessionStorage.setItem('sakura-ink-opening','1');}catch{}
  const NativeAudio=window.Audio;window.startupEvents=[];window.startupAlerts=[];let rejected=false;
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='fixture-audio-range')window.startupEvents.push({kind:'worker-range',...event.data,time:performance.now()});});
  window.Audio=function(...args){const a=new NativeAudio(...args);window.startupAudio=a;
   for(const kind of ['error','pause','playing','loadstart','waiting','loadedmetadata'])a.addEventListener(kind,()=>window.startupEvents.push({kind,src:a.src,paused:a.paused,code:a.error?.code,time:performance.now()}));
   const play=a.play.bind(a),load=a.load.bind(a);
   a.play=()=>{const src=a.src;window.startupEvents.push({kind:'play-call',src,time:performance.now()});const p=mode==='promise-failure'&&src.includes('/fixture-direct.wav')&&!rejected?(rejected=true,Promise.reject(new DOMException('Network temporarily interrupted','NetworkError'))):play();p.then(()=>window.startupEvents.push({kind:'play-resolved',src,time:performance.now()}),e=>window.startupEvents.push({kind:'play-rejected',src,name:e.name,time:performance.now()}));return p;};
   a.load=()=>{window.startupEvents.push({kind:'load-call',src:a.src,time:performance.now()});return load();};return a;};window.Audio.prototype=NativeAudio.prototype;
  new MutationObserver(()=>{for(const node of document.querySelectorAll('[role="alert"]')){const text=node.textContent;if(text&&!window.startupAlerts.includes(text))window.startupAlerts.push(text);}}).observe(document,{childList:true,subtree:true});
 },mode);
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.browserConsole.push(m.text());});page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),failure:r.failure()}));page.on('response',r=>{if(r.url().includes('/_sakura/audio/'))report.mediaResponses.push({url:r.url(),status:r.status(),worker:r.fromServiceWorker(),range:r.request().headers().range});});page.setDefaultTimeout(45000);
 await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});try{await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().waitFor();}catch(error){await page.screenshot({path:'.local/playback-startup-opening-failure.png'});console.error(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,4000),pageErrors:report.pageErrors}));throw error;}
 return {context,page};
}
async function snapshot(page){return page.evaluate(()=>({events:window.startupEvents,alerts:window.startupAlerts,src:window.startupAudio.src,time:window.startupAudio.currentTime,paused:window.startupAudio.paused}));}
async function storage(page){return page.evaluate(async accountId=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sakura-ink-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('entries'),s=tx.objectStore('entries'),keys=s.getAllKeys(),values=s.getAll();tx.oncomplete=()=>resolve(values.result.map((value,i)=>({key:String(keys.result[i]),value})).filter(r=>r.key.startsWith('account:'+accountId+':')).map(r=>({key:r.key,status:r.value.status,requested:r.value.requested,mode:r.value.mode,offset:r.value.offset,size:r.value.blob?.size})));tx.onerror=()=>reject(tx.error);});}finally{db.close();}},account.id);}
async function restorePrefix(page){
 await page.evaluate(async({accountId,track,assetId,sizeBytes,sha256,chunk,mimeType})=>{
  let stage='open';try{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sakura-ink-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  stage='digest';
  const data=Uint8Array.from(atob(chunk),c=>c.charCodeAt(0)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
  stage='save';
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite'),s=tx.objectStore('entries'),prefix='account:'+accountId+':';s.put({version:1,recordingId:track.id,track,status:'downloading',mode:'full',requested:true,priority:0,chunkBytes:262144,createdAt:Date.now(),updatedAt:Date.now(),fingerprint:{assetId,sizeBytes,sha256},mimeType},prefix+'download:'+track.id);s.put({offset:0,blob:new Blob([data],{type:mimeType}),sha256:digest},prefix+'chunk:'+track.id+':0');tx.oncomplete=resolve;tx.onerror=event=>reject(event.target.error||tx.error||new Error('IndexedDB aborted the fixture write'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB aborted the fixture write'));});}finally{db.close();}
  stage='register';await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  }catch(error){throw new Error('Restoring prefix during '+stage+': '+error?.name+' '+error?.message);}
 },{accountId:account.id,track,assetId,sizeBytes:wav.length,sha256,mimeType,chunk:wav.subarray(0,262144).toString('base64')});
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().waitFor();
}
async function navGeometry(page){return page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="Mobile navigation"]'),bar=document.querySelector('footer:has(button[aria-label="Open now playing"])');const r=nav.getBoundingClientRect(),p=bar?.getBoundingClientRect();return{viewport:visualViewport.offsetTop+visualViewport.height,layoutViewport:innerHeight,bottom:r.bottom,top:r.top,height:r.height,padding:getComputedStyle(nav).paddingBottom,barBottom:p?.bottom,barTop:p?.top};});}
try{
 for(const mode of (process.env.SAKURA_STARTUP_SCENARIOS||'fallback-race,promise-failure,slow-progressive,restored-download,lyrics-change,mobile-nav').split(',')){
  const {context,page}=await open(mode);
  try{
   if(mode==='mobile-nav'){
    const normal=await navGeometry(page);assert.ok(Math.abs(normal.bottom-normal.viewport)<=1,JSON.stringify(normal));
    await page.evaluate(()=>{window.fixtureViewportHeight=visualViewport.height;window.fixtureViewportTop=visualViewport.offsetTop;Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>window.fixtureViewportHeight});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>window.fixtureViewportTop});window.fixtureViewportHeight=480;visualViewport.dispatchEvent(new Event('resize'));});
    await expect.poll(async()=>{const r=await navGeometry(page);return Math.abs(r.bottom-r.viewport);}).toBeLessThanOrEqual(1);const normalVisible=await navGeometry(page);
    await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
    await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.startupAudio.currentTime>0)).toBe(true);
    const playing=await navGeometry(page);assert.ok(Math.abs(playing.bottom-playing.viewport)<=1,JSON.stringify(playing));assert.ok(Math.abs(playing.barBottom-playing.top)<=1,JSON.stringify(playing));
    await page.screenshot({path:'.local/playback-startup-mobile-nav-'+browserName+'.png'});
    await page.setViewportSize({width:320,height:480});await expect.poll(async()=>{const r=await navGeometry(page);return Math.abs(r.bottom-r.viewport);}).toBeLessThanOrEqual(1);const resized=await navGeometry(page);
    // Exercise the standalone/iOS distinction without pretending desktop browser emulation provides an iOS system window.
    await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:400});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:17});visualViewport.dispatchEvent(new Event('resize'));});
    await expect.poll(async()=>{const r=await navGeometry(page);return Math.abs(r.bottom-r.viewport);}).toBeLessThanOrEqual(1);const visible=await navGeometry(page);assert.notEqual(visible.viewport,visible.layoutViewport);
    assert.ok(Math.abs(visible.barBottom-visible.top)<=1,JSON.stringify(visible));
    report.scenarios.push({mode,normal,normalVisible,playing,resized,visible});report.checks.push('iPhone SE sized navigation reaches the visual viewport edge with and without a mini player, after resizing and with a separate standalone viewport');continue;
   }
   if(mode==='lyrics-change'){
    await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().click();await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.locator('dialog[data-dialog-appearance="player"]').getByRole('button',{name:'Lyrics',exact:true}).click();
    const dialog=page.locator('dialog[data-dialog-appearance="lyrics"]'),scroll=dialog.locator('[data-player-scroll]'),view=dialog.locator('[data-lyrics-follow]');await dialog.locator('[data-lyric-index="0"]').waitFor();
    await scroll.evaluate(node=>{node.dispatchEvent(new WheelEvent('wheel',{deltaY:5000}));node.scrollTop=5000;});await expect(view).toHaveAttribute('data-lyrics-follow','false');
    await dialog.getByRole('button',{name:'Next song',exact:true}).click();await expect(dialog.getByRole('heading',{name:nextTrack.title,exact:true})).toBeVisible();await dialog.locator('[data-lyric-index="0"]').waitFor();await page.waitForTimeout(400);
    assert.equal(await view.getAttribute('data-lyrics-follow'),'true','The next song follows automatically after browsing the previous song');
    await page.evaluate(()=>{window.startupAudio.currentTime=42;window.startupAudio.dispatchEvent(new Event('timeupdate'));});await expect(dialog.locator('[data-lyric-index="21"]')).toHaveAttribute('aria-current','true');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(500);
    await scroll.evaluate(node=>{node.dispatchEvent(new WheelEvent('wheel',{deltaY:5000}));node.scrollTop=5000;});await expect(view).toHaveAttribute('data-lyrics-follow','false');await page.waitForTimeout(250);
    await scroll.evaluate(node=>{const line=node.querySelector('[aria-current="true"][data-lyric-index]'),r=line.getBoundingClientRect(),v=node.getBoundingClientRect(),controls=node.querySelector('[class*="lyricsControls"]').getBoundingClientRect();node.scrollTop+=((r.top+r.bottom)/2)-(v.top+12+(controls.top-v.top-24)*.4);});await expect(view).toHaveAttribute('data-lyrics-follow','true');
    report.scenarios.push({mode,follow:await view.getAttribute('data-lyrics-follow')});report.checks.push('The open lyrics dialog follows the next song after manual browsing, delayed lyrics and advancing verses');continue;
   }
   if(mode==='restored-download')await restorePrefix(page);
   if(mode==='slow-progressive'){
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
    // An explicit save stays active independently of startup and pause.
    await page.getByRole('button',{name:'Download '+track.title,exact:true}).first().click();
   }
   const startedAt=Date.now();await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().click();
   if(mode==='restored-download'){
    await expect.poll(()=>page.evaluate(()=>window.startupAudio.currentTime>1&&!window.startupAudio.paused),{timeout:10000}).toBe(true);
    const result=await snapshot(page),rows=await storage(page);assert.deepEqual(result.alerts,[]);assert.ok(result.src.includes('/_sakura/audio/'));assert.equal(rows.some(row=>row.key.includes(':audio:'+recordingId)),false);report.scenarios.push({mode,...result,rows});report.checks.push('A reopened partial download plays its saved prefix during a resolver outage while remaining incomplete');continue;
   }
   if(mode==='slow-progressive'){
    await page.waitForTimeout(12500);const waiting=await snapshot(page);assert.deepEqual(waiting.alerts,[],'A slow healthy first chunk never produces a playback error');assert.equal(waiting.src,'','The media source waits for its first verified chunk');
   }
   await expect.poll(()=>page.evaluate(()=>window.startupAudio.currentTime>1&&!window.startupAudio.paused),{timeout:45000}).toBe(true);
   const result=await snapshot(page);result.mode=mode;result.elapsedMs=Date.now()-startedAt;assert.deepEqual(result.alerts,[],'Transient startup trouble recovers without a failure card');
   if(mode==='fallback-race'){assert.ok(result.src.endsWith('/fixture-fallback.wav'));assert.equal(result.events.filter(e=>e.kind==='load-call'&&e.src.endsWith('/fixture-fallback.wav')).length,1,'Error event and original play rejection share a single fallback load');report.checks.push('Actual HTTP media failure and original play rejection open one healthy fallback without canceling each other');}
   if(mode==='promise-failure'){assert.ok(result.events.some(e=>e.kind==='play-rejected'&&e.name==='NetworkError'));assert.ok(result.events.filter(e=>e.kind==='play-call'&&e.src.endsWith('/fixture-direct.wav')).length>=2);report.checks.push('A first-attempt transient Audio.play rejection automatically recovers without an error event or manual retry');}
   if(mode==='slow-progressive'){
    assert.ok(result.src.includes('/_sakura/audio/'),'Playback starts from the real chunk bridge');const beforePause=await storage(page);result.storageAtStart=beforePause;
    assert.ok(beforePause.some(row=>row.key.includes(':download:'+recordingId)&&row.requested===true),'Explicit download is still in progress when playback starts');assert.equal(beforePause.some(row=>row.key.includes(':audio:'+recordingId)),false,'Playback starts before the whole song is saved');
    const footer=page.locator('footer').filter({has:page.getByRole('button',{name:'Open now playing',exact:true})});await footer.getByRole('button',{name:'Pause',exact:true}).click();const marker=ranges.length;
    await expect.poll(async()=>{const rows=await storage(page);return rows.some(row=>row.key.includes(':audio:'+recordingId))||rows.filter(row=>row.key.includes(':chunk:'+recordingId)).length>beforePause.filter(row=>row.key.includes(':chunk:'+recordingId)).length;},{timeout:15000}).toBe(true);
    assert.deepEqual((await snapshot(page)).alerts,[]);result.ranges=ranges.filter(row=>row.scenario===mode);result.rangeCountAfterPause=ranges.length-marker;report.checks.push('A first chunk taking more than 12 seconds starts actual progressive playback before the full save; pausing leaves the explicit download running');
   }
   report.scenarios.push(result);
  }catch(error){report.scenarios.push({mode,failure:String(error),...await snapshot(page)});await page.screenshot({path:'.local/playback-startup-'+mode+'-failure.png'});throw error;}
  finally{await context.close();}
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.blockedWrites,[]);console.log(JSON.stringify({passed:report.checks.length,checks:report.checks,pageErrors:0,serverDatabaseWrites:0}));
}finally{await writeFile('.local/playback-startup-browser-'+browserName+'-'+extension+(process.env.SAKURA_STARTUP_SCENARIOS?'-'+process.env.SAKURA_STARTUP_SCENARIOS.replaceAll(',','-'):'')+'-report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();for(const flight of flights)flight.abort();for(const socket of sockets)socket.destroy();await new Promise(resolve=>{proxy.close(resolve);proxy.closeAllConnections();});}
