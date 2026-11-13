/** Actual MusicProvider + service worker with checksum-verified real songs and controlled slow delivery. */
import assert from 'node:assert/strict';
import 'dotenv/config';
import {createServer, request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {chromium, expect as playwrightExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import {performanceApi} from './fixtures/performance-browser.mjs';

const expect=playwrightExpect.configure({timeout:45000});
const upstream=new URL(process.env.SAKURA_TEST_URL||'http://localhost:3000');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(upstream.hostname));
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'The isolated browser session needs local signing configuration');
const account={id:'90000000-0000-4000-8000-000000000096',username:'Real audio startup',email:'startup@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const manifest=JSON.parse(await readFile('.local/real-audio-startup/transport-report.json','utf8'));
const songKeys=(process.env.SAKURA_REAL_AUDIO_SONGS||'finesse,inertia,ye').split(',');
const modes=(process.env.SAKURA_REAL_AUDIO_MODES||'play,manual-then-play').split(',');
const liveSource=process.env.SAKURA_REAL_AUDIO_LIVE_SOURCE==='1';
const stripTags=process.env.SAKURA_REAL_AUDIO_STRIP_TAGS==='1';
assert.ok(!liveSource||!stripTags,'Derived tag-free files are replay fixtures rather than the original upstream asset');
const assets=[];
for(const key of songKeys){
 const proof=manifest.results.find(row=>row.key===key&&row.fullVerified);
 assert.ok(proof,'Download and verify '+key+' with rebuild-real-audio-startup.mts --live first');
 let bytes=await readFile(proof.file);
 let hash=createHash('sha256').update(bytes).digest('hex');
 assert.equal(bytes.length,proof.sizeBytes);assert.equal(hash,proof.expectedSha256);
 let tagEnd=bytes.subarray(0,3).toString()==='ID3'?10+(bytes[6]&127)*2097152+(bytes[7]&127)*16384+(bytes[8]&127)*128+(bytes[9]&127):0;
 if(stripTags){bytes=bytes.subarray(tagEnd);hash=createHash('sha256').update(bytes).digest('hex');tagEnd=0;}
 const metadata={title:proof.title,artists:proof.artists,artistsComplete:true,durationMs:proof.measured.durationMs};
 const track={id:proof.recordingId,recordingId:proof.recordingId,...metadata,metadata,artistId:null,albumId:null,reference:{provider:'deezer',id:key},references:[{provider:'deezer',id:key}]};
 const assetId=stripTags?`d0000000-0000-4000-8000-${String(assets.length+1).padStart(12,'0')}`:proof.assetId;
 const fallbackUrl=`/api/v2/recordings/${track.id}/audio?assetId=${assetId}`;
 track.readyPlayback={kind:'stream',delivery:'cdn',assetId,sizeBytes:bytes.length,sha256:hash,mimeType:'audio/mpeg',durationMs:metadata.durationMs,
  url:`https://res.cloudinary.com/real-audio-startup-fixture/video/upload/v1/sakura/v2/audio/${track.id}/${hash}.mp3`,fallbackUrl};
 if(liveSource){assert.ok(proof.publicSourceUrl);const remote=new URL(proof.publicSourceUrl);assert.equal(remote.origin,'https://res.cloudinary.com');assert.ok(!remote.username&&!remote.password);}
 assets.push({key,track,bytes,tagEnd,publicSourceUrl:proof.publicSourceUrl});
}
const blockBytes=Number(process.env.SAKURA_REAL_AUDIO_BLOCK_BYTES||16384),blockMs=Number(process.env.SAKURA_REAL_AUDIO_BLOCK_MS||250);
assert.ok(blockBytes>=1024&&blockBytes<=65536&&blockMs>=1&&blockMs<=1000);
const report={checkedAt:new Date().toISOString(),scope:'Actual Next MusicProvider, browser decoder and production service worker replaying complete real provider files with canonical SHA256 checks. API/account state is synthetic and saved only in this isolated browser. The real provider transfer and full decoding evidence is in transport-report.json.',
 liveSource,stripTags,bytesPerSecondPerResponse:liveSource?null:Math.round(blockBytes*1000/blockMs),sourceHashes:{},results:[],pageErrors:[],unexpectedWrites:[],apiRequests:[],browserErrors:[],proxyErrors:[]};
if(liveSource)report.scope='Actual Next MusicProvider, browser decoder and production service worker fetching real byte ranges from existing checksum-verified public CDN assets. API/account state is synthetic and saved only in this isolated browser. Full canonical file verification is in transport-report.json; this run uses the actual upstream rather than controlled replay.';
if(stripTags)report.scope+=' This additional fixture removes leading ID3 tags from the already verified real MP3, assigns a separate synthetic asset identity/checksum, and tests zero-offset audio without changing the canonical saved provider files.';
for(const file of ['src/rebuild/app/MusicContext.tsx','src/rebuild/app/downloadEngine.ts','src/rebuild/app/downloadRange.ts','src/rebuild/app/partialPlayback.ts','public/sw.js']){
 report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
}
const flights=new Set(),sockets=new Set(),audioResponses=new Set();
let activeAsset,fixtureApi,activeResult,session=null,base,fastDelivery=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function json(response,value,status=200){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
async function audio(request,response){
 const asset=activeAsset,result=activeResult,bytes=asset.bytes,range=request.headers.range,method=request.method||'GET';
 audioResponses.add(response);response.once('close',()=>audioResponses.delete(response));
 const match=range&&/^bytes=(\d+)-(\d*)$/.exec(range);
 const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;
 if(start>end||start>=bytes.length){response.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});response.end();return;}
 const row={path:new URL(request.url,base).pathname,start,end,range:range||null,startedAt:Date.now(),bytes:0};result.requests.push(row);
 const headers={'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges,ETag,Content-Type','ETag':'"'+asset.track.readyPlayback.sha256+'"'};
 if(match)headers['Content-Range']=`bytes ${start}-${end}/${bytes.length}`;
 if(liveSource){
  const controller=new AbortController(),stop=()=>{if(!response.writableEnded)controller.abort();};response.on('close',stop);flights.add(controller);
  try{const source=await fetch(asset.publicSourceUrl,{method,headers:{Range:`bytes=${start}-${end}`,'Accept-Encoding':'identity'},cache:'no-store',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});assert.equal(source.status,206);assert.equal(source.headers.get('Content-Range'),`bytes ${start}-${end}/${bytes.length}`);assert.equal(Number(source.headers.get('Content-Length')),end-start+1);row.headersMs=Date.now()-row.startedAt;response.writeHead(match?206:200,headers);response.flushHeaders();if(method==='HEAD'){await source.body?.cancel();response.end();return;}assert.ok(source.body);for await(const part of source.body){if(response.destroyed)return;row.bytes+=part.byteLength;assert.ok(row.bytes<=end-start+1);result.networkBytes+=part.byteLength;response.write(part);}assert.equal(row.bytes,end-start+1);response.end();row.complete=true;row.finishedAt=Date.now();}finally{flights.delete(controller);response.removeListener('close',stop);controller.abort();}
  return;
 }
 response.writeHead(match?206:200,headers);response.flushHeaders();
 if(request.method==='HEAD'){response.end();return;}
 for(let offset=start;offset<=end;){
  if(response.destroyed)return;
  const part=bytes.subarray(offset,Math.min(end+1,offset+(fastDelivery?262144:blockBytes)));
  response.write(part);row.bytes+=part.length;result.networkBytes+=part.length;
  offset+=part.length;await pause(fastDelivery?1:blockMs);
 }
 if(!response.destroyed){response.end();row.complete=true;row.finishedAt=Date.now();}
}
const proxy=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,base||'http://fixture.invalid'),path=url.pathname,method=request.method||'GET';
  if(path==='/fixture-audio.mp3'||/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path)){await audio(request,response);return;}
  if(path==='/__nextjs_original-stack-frames'){json(response,{frames:[]});return;}
  if(path.startsWith('/api/')){
   report.apiRequests.push({path,method});
   const chunks=[];for await(const part of request)chunks.push(part);
   const text=Buffer.concat(chunks).toString('utf8'),input=text?JSON.parse(text):{};
   if(path==='/api/v2/library'){json(response,{recordings:[activeAsset.track],playlists:[]});return;}
   if(path==='/api/v2/listening-session'){
    if(method==='PUT')session={state:input.state,revision:input.revision+1,deviceId:input.deviceId,updatedAt:Date.now()};
    json(response,{accepted:true,session,serverTime:Date.now(),protocol:1});return;
   }
   const result=fixtureApi.handle({url:url.href,method,headers:request.headers,body:input});
   if(result.unexpected&&method!=='GET'&&method!=='HEAD')report.unexpectedWrites.push({path,method});
   json(response,result.unexpected&&['GET','HEAD'].includes(method)?{items:[],recordings:[]}:result.json,result.unexpected&&['GET','HEAD'].includes(method)?200:result.status);return;
  }
  if(!['GET','HEAD'].includes(method)){report.unexpectedWrites.push({path,method});json(response,{error:'Read-only application boundary'},405);return;}
  const controller=new AbortController();flights.add(controller);response.on('close',()=>{if(!response.writableEnded)controller.abort();});
  try{
   const headers=new Headers();for(const[name,value]of Object.entries(request.headers))if(value!==undefined&&!['host','connection','content-length','accept-encoding','transfer-encoding','upgrade','keep-alive'].includes(name))headers.set(name,Array.isArray(value)?value.join(', '):value);
   headers.set('accept-encoding','identity');
   const result=await fetch(new URL(url.pathname+url.search,upstream),{method,headers,redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
   const forwarded={};result.headers.forEach((value,name)=>{if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(name))forwarded[name]=value;});
   if(forwarded.location){const redirect=new URL(forwarded.location,upstream);assert.equal(redirect.origin,upstream.origin);forwarded.location=new URL(redirect.pathname+redirect.search,base).href;}
   const body=Buffer.from(await result.arrayBuffer());forwarded['Content-Length']=String(body.length);response.writeHead(result.status,forwarded);response.end(method==='HEAD'?undefined:body);
  }finally{flights.delete(controller);}
 }catch(error){report.proxyErrors.push({path:new URL(request.url,base).pathname,errorCategory:error.name});if(!response.destroyed){if(!response.headersSent)response.writeHead(502);response.end();}}
});
proxy.on('upgrade',(request,socket,head)=>{
 if(!request.url?.startsWith('/_next/hmr')){socket.destroy();return;}
 const connection=httpRequest(new URL(request.url,upstream),{headers:{...request.headers,host:upstream.host,origin:upstream.origin}});
 connection.on('upgrade',(response,peer,peerHead)=>{sockets.add(socket);sockets.add(peer);socket.on('close',()=>sockets.delete(socket));peer.on('close',()=>sockets.delete(peer));socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');if(peerHead.length)socket.write(peerHead);if(head.length)peer.write(head);socket.pipe(peer);peer.pipe(socket);});
 connection.on('response',response=>{socket.end();response.resume();});connection.on('error',()=>socket.destroy());connection.end();
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+proxy.address().port;
await mkdir('.local/real-audio-startup',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const asset of assets)for(const mode of modes){
  assert.ok(['play','manual-then-play'].includes(mode));activeAsset=asset;session=null;fastDelivery=false;
  fixtureApi=performanceApi({account,catalog:{tracks:[asset.track],wav:asset.bytes},settings:{audioTechnology:'none',privateSession:true,volume:.05,reducedMotion:true}});
  activeResult={song:asset.key,mode,sizeBytes:asset.bytes.length,leadingTagBytes:asset.tagEnd,networkBytes:0,requests:[],events:[]};report.results.push(activeResult);
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{
   sessionStorage.setItem('sakura-ink-opening','1');
   const NativeAudio=window.Audio;window.realAudioEvents=[];
   window.Audio=function(...args){const audio=new NativeAudio(...args);window.realAudio=audio;
    for(const kind of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','error','pause'])audio.addEventListener(kind,()=>window.realAudioEvents.push({kind,at:Date.now(),time:audio.currentTime,readyState:audio.readyState,code:audio.error?.code,src:audio.src}));
    return audio;};window.Audio.prototype=NativeAudio.prototype;
  });
  // The app receives the real immutable ready identity; only transport is replayed locally.
  await context.route('https://res.cloudinary.com/real-audio-startup-fixture/**',route=>route.fulfill({status:307,headers:{Location:base+'/fixture-audio.mp3','Access-Control-Allow-Origin':'*'}}));
  const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.browserErrors.push(message.text());});
  try{
   await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});
   await page.getByRole('button',{name:'Play '+asset.track.title,exact:true}).first().waitFor();
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
   activeResult.workStartedAt=Date.now();
   if(mode==='manual-then-play'){await page.getByRole('button',{name:'Download '+asset.track.title,exact:true}).first().click();await page.waitForTimeout(250);}
   activeResult.playClickedAt=Date.now();await page.getByRole('button',{name:'Play '+asset.track.title,exact:true}).first().click();
   await expect.poll(()=>page.evaluate(()=>window.realAudioEvents?.some(event=>event.kind==='playing')),{timeout:45000,intervals:[50,100,250]}).toBe(true);
   const snapshot=await page.evaluate(()=>({events:window.realAudioEvents,src:window.realAudio.src,time:window.realAudio.currentTime,duration:window.realAudio.duration,paused:window.realAudio.paused,error:window.realAudio.error?.code||null,alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent)}));
   activeResult.events=snapshot.events;const first=snapshot.events.find(event=>event.kind==='playing');
   activeResult.playingMs=first.at-activeResult.playClickedAt;activeResult.bytesAtPlaying=activeResult.networkBytes;
   activeResult.initialChunkIncompleteAtPlaying=activeResult.requests.filter(request=>request.start===0&&request.end>=262143).every(request=>!request.complete||request.finishedAt>first.at);
   activeResult.downloadFractionAtPlaying=activeResult.networkBytes/asset.bytes.length;
   activeResult.source=snapshot.src.includes('/_sakura/audio/')?'partial-service-worker':snapshot.src.startsWith('blob:')?'blob':'remote';
   activeResult.duration=snapshot.duration;activeResult.error=snapshot.error;activeResult.alerts=snapshot.alerts;
   activeResult.fullSavedAtStartup=await page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(key);request.onsuccess=()=>resolve(!!request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}},`account:${account.id}:audio:${asset.track.id}`);
   assert.equal(activeResult.fullSavedAtStartup,false,'The real song must play before its complete offline save');assert.equal(snapshot.error,null);assert.deepEqual(snapshot.alerts,[]);
   await expect.poll(()=>page.evaluate(()=>window.realAudio.currentTime),{timeout:10000,intervals:[100,250]}).toBeGreaterThan(1);
   activeResult.timeAdvanced=true;
   if(process.env.SAKURA_REAL_AUDIO_CONTINUITY==='1'){
    const samples=await page.evaluate(async()=>{const rows=[];for(let index=0;index<15;index++){rows.push({at:Date.now(),time:window.realAudio.currentTime,readyState:window.realAudio.readyState,paused:window.realAudio.paused,error:window.realAudio.error?.code||null});await new Promise(resolve=>setTimeout(resolve,1000));}rows.push({at:Date.now(),time:window.realAudio.currentTime,readyState:window.realAudio.readyState,paused:window.realAudio.paused,error:window.realAudio.error?.code||null});return rows;});
    activeResult.continuity=samples;activeResult.continuousMediaSeconds=samples.at(-1).time-samples[0].time;
    assert.ok(activeResult.continuousMediaSeconds>14.2,asset.key+' must advance throughout fifteen seconds of playback');
    assert.ok(samples.every(sample=>!sample.paused&&sample.error===null));
    const target=Math.max(0,snapshot.duration-7),seekAt=Date.now();
    await page.evaluate(target=>{window.realAudio.currentTime=target;},target);
    await expect.poll(()=>page.evaluate(target=>window.realAudio.currentTime>target+.5&&!window.realAudio.paused&&window.realAudio.readyState>=3,target),{timeout:15000,intervals:[100,250]}).toBe(true);
    activeResult.seek={target,resumedMs:Date.now()-seekAt,...await page.evaluate(()=>({time:window.realAudio.currentTime,duration:window.realAudio.duration,error:window.realAudio.error?.code||null}))};
    activeResult.events=await page.evaluate(()=>window.realAudioEvents);
    activeResult.waitingAfterStart=activeResult.events.filter(event=>event.kind==='waiting'&&event.at>first.at&&event.at<seekAt);
    assert.deepEqual(activeResult.waitingAfterStart,[],asset.key+' must not underrun during normal playback');
   }
   const storage=await page.evaluate(async accountId=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction('entries'),store=tx.objectStore('entries'),values=store.getAll(),keys=store.getAllKeys();tx.oncomplete=()=>resolve(values.result.map((value,index)=>({key:String(keys.result[index]),value})).filter(row=>row.key.startsWith('account:'+accountId+':')).map(({key,value})=>({key,offset:value.offset,blobBytes:value.blob?.size,status:value.status,requested:value.requested})));tx.onerror=()=>reject(tx.error);});}finally{db.close();}
   },account.id);
   activeResult.storage=storage;activeResult.fullSavedAfterContinuity=storage.some(row=>row.key===`account:${account.id}:audio:${asset.track.id}`);
   if(asset.key==='inertia'&&mode==='manual-then-play'&&process.env.SAKURA_REAL_AUDIO_COMPLETE_SAVE==='1'){
    await page.evaluate(()=>window.realAudio.pause());fastDelivery=true;
    const savedKey=`account:${account.id}:audio:${asset.track.id}`;
    await expect.poll(()=>page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(key);request.onsuccess=()=>resolve(!!request.result?.blob);request.onerror=()=>reject(request.error);});}finally{db.close();}},savedKey),{timeout:30000,intervals:[100,250,500]}).toBe(true);
    activeResult.completeSave=await page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});let saved;try{saved=await new Promise((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}const digest=await crypto.subtle.digest('SHA-256',await saved.blob.arrayBuffer());return {sizeBytes:saved.blob.size,storedSha256:saved.sha256,actualSha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};},savedKey);
    assert.equal(activeResult.completeSave.sizeBytes,asset.bytes.length);assert.equal(activeResult.completeSave.actualSha256,asset.track.readyPlayback.sha256);assert.equal(activeResult.completeSave.storedSha256,asset.track.readyPlayback.sha256);
    await context.setOffline(true);
    activeResult.offlinePlayback=await page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});let saved;try{saved=await new Promise((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}const audio=document.createElement('audio'),url=URL.createObjectURL(saved.blob);try{audio.volume=.05;audio.src=url;await audio.play();await new Promise(resolve=>setTimeout(resolve,1500));return {duration:audio.duration,time:audio.currentTime,error:audio.error?.code||null,offline:!navigator.onLine};}finally{audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);}},savedKey);
    assert.equal(activeResult.offlinePlayback.offline,true);assert.equal(activeResult.offlinePlayback.error,null);assert.ok(activeResult.offlinePlayback.time>1);assert.ok(Math.abs(activeResult.offlinePlayback.duration-snapshot.duration)<.1);
   }
   if(process.env.SAKURA_REAL_AUDIO_REQUIRE_FAST==='1'){
    assert.ok(activeResult.playingMs<5000,asset.key+' must play within five seconds on the controlled slow source');
    assert.ok(activeResult.bytesAtPlaying<512*1024,asset.key+' must start before half a MiB is transferred');
    assert.equal(activeResult.initialChunkIncompleteAtPlaying,true,asset.key+' must start before the original first 256 KiB chunk completes');
   }
   console.log(JSON.stringify({song:asset.key,mode,playingMs:activeResult.playingMs,bytesAtPlaying:activeResult.bytesAtPlaying,fraction:activeResult.downloadFractionAtPlaying,source:activeResult.source,timeAdvanced:true,continuousMediaSeconds:activeResult.continuousMediaSeconds,seekMs:activeResult.seek?.resumedMs,fullSaveVerified:!!activeResult.completeSave,offlinePlayed:!!activeResult.offlinePlayback}));
  }catch(error){activeResult.failure=String(error);activeResult.body=(await page.locator('body').innerText()).slice(0,2000);await page.screenshot({path:'.local/real-audio-startup/'+asset.key+'-'+mode+'-failure.png'});throw error;}
  finally{await context.close();for(const response of audioResponses)response.destroy();await writeFile('.local/real-audio-startup/'+(process.env.SAKURA_REAL_AUDIO_REPORT||'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.unexpectedWrites,[]);
}finally{await browser.close();for(const controller of flights)controller.abort();for(const socket of sockets)socket.destroy();await new Promise(resolve=>{proxy.close(resolve);proxy.closeAllConnections();});}
