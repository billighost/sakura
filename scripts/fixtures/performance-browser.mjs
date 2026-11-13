/** Version 2: strict synthetic API/media boundary for production performance checks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';

export const PERFORMANCE_FIXTURE_VERSION=2;
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function localOrigin(value){
 const url=new URL(value);
 assert.ok(['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password,'Performance fixtures only visit a loopback production origin');
 return url.origin;
}
export function performanceCatalog({count=12,offset=8700,label='Performance song',worlds=['sakura']}={}){
 const rate=8000,durationMs=90000,samples=rate*durationMs/1000,wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i/rate*220*Math.PI*2)*900),44+i*2);
 const sha256=createHash('sha256').update(wav).digest('hex');
 const tracks=Array.from({length:count},(_,i)=>{
  const id=`80000000-0000-4000-8000-${String(offset+i).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(offset+i).padStart(12,'0')}`;
  const metadata={title:`${label} ${i+1}${i%6===0?' with a longer title to check line wrapping':''}`,artists:['Synthetic artist'],artistsComplete:true,durationMs,coverUrl:`/bloom/covers/${worlds[i%worlds.length]}-light-480.webp`,albumTitle:'Synthetic performance album'};
  return {id,recordingId:id,...metadata,metadata,artistId:null,albumId:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(offset+i)},references:[{provider:'deezer',id:String(offset+i)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256,mimeType:'audio/wav',durationMs,url:`https://res.cloudinary.com/performance-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha256}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
 });
 return {tracks,wav,sha256,durationMs};
}
export function performanceApi({account,catalog,pageSize=12,settings:overrides={}}){
 const settings={theme:'light',audioQuality:'data-saver',audioTechnology:'none',japaneseReading:false,privateSession:true,reducedMotion:false,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,artistVariety:.65,repeatTolerance:.45,newReleaseBias:.5,deepCutBias:.35,timeAware:true,learnFromListening:false,timeZone:'Africa/Lagos',explicitContent:true,volume:.1,shuffle:false,repeat:'off',previewVolume:.1,previewLoop:true,sleepTimerMinutes:15,...overrides};
 const fieldRevisions=Object.fromEntries(Object.keys(settings).map(key=>[key,0])),favoriteStates={},roomPreferences={};
 const generatedAt=new Date().toISOString();let settingsRevision=0,session=null;
 const json=(value,status=200)=>({status,json:value});
 const notAllowed=(path,method)=>({status:501,json:{error:`Unmodeled synthetic API: ${method} ${path}`},unexpected:true});
 function media(headers={},method='GET'){
  const match=String(headers.range||'').match(/^bytes=(\d+)-(\d*)$/),start=match?Number(match[1]):0,end=match&&match[2]?Math.min(catalog.wav.length-1,Number(match[2])):catalog.wav.length-1;
  if(start> end||start>=catalog.wav.length)return {status:416,headers:{'Content-Range':`bytes */${catalog.wav.length}`},body:Buffer.alloc(0)};
  const responseHeaders={'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
  if(match)responseHeaders['Content-Range']=`bytes ${start}-${end}/${catalog.wav.length}`;
  return {status:match?206:200,contentType:'audio/wav',headers:responseHeaders,body:method==='HEAD'?Buffer.alloc(0):catalog.wav.subarray(start,end+1)};
 }
 function handle({url,method='GET',headers={},body={}}){
  const parsed=new URL(url,'http://fixture.invalid'),path=parsed.pathname;
  if(headers['x-sakura-account']&&headers['x-sakura-account']!==account.id)return json({error:'Account changed'},401);
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path)){
   const selected=catalog.tracks.find(track=>path===new URL(track.readyPlayback.fallbackUrl,'http://fixture.invalid').pathname);
   if(!selected)return json({error:'Unknown synthetic audio'},404);
   if(parsed.searchParams.get('assetId')&&parsed.searchParams.get('assetId')!==selected.readyPlayback.assetId)return json({error:'Wrong synthetic asset'},409);
   return media(headers,method);
  }
  if(path==='/api/auth/session'&&method==='GET')return json({user:account});
  if((path==='/api/v2/bootstrap'||path==='/api/v2/profile')&&method==='GET')return json({profile:account,stats:{},topArtists:[],topSongs:[]});
  if(path==='/api/v2/settings'){
   if(method==='PATCH'){const {expectedRevision,...patch}=body;if(expectedRevision!==undefined&&expectedRevision!==settingsRevision)return json({error:'Settings changed'},409);if(Object.keys(patch).some(key=>!(key in settings)))return notAllowed(path,method);Object.assign(settings,patch);settingsRevision++;for(const key of Object.keys(patch))fieldRevisions[key]=settingsRevision;}
   else if(method!=='GET')return notAllowed(path,method);
   return json({...settings,revision:settingsRevision,fieldRevisions:{...fieldRevisions}});
  }
  if(path==='/api/v2/library/state'&&method==='GET')return json({favoriteStates:{...favoriteStates}});
  if(path==='/api/v2/library'){
   if(method==='GET')return json({recordings:catalog.tracks.filter(track=>favoriteStates[track.id]?.liked),playlists:[],nextCursor:null});
   if(method==='POST'&&catalog.tracks.some(track=>track.id===body.recordingId)&&typeof body.operationId==='string'&&typeof body.liked==='boolean'){
    const id=body.recordingId,revision=(favoriteStates[id]?.revision||0)+1;favoriteStates[id]={liked:body.liked,revision,updatedAt:Date.now()};return json({recordingId:id,operationId:body.operationId,accepted:true,...favoriteStates[id]});
   }
   return notAllowed(path,method);
  }
  if(path==='/api/v2/taste'&&method==='GET')return json({feedback:[],tasteEvidence:[]});
  if(path==='/api/v2/listening-session'){
   if(method==='GET')return json({session,serverTime:Date.now(),protocol:1});
   if(method==='PUT'&&body.state&&Array.isArray(body.state.queue)&&body.state.queue.length<=80&&Number.isSafeInteger(body.revision)&&typeof body.deviceId==='string'){
    if(body.revision!==(session?.revision||0))return json({accepted:false,session,serverTime:Date.now(),protocol:1});
    session={state:body.state,revision:body.revision+1,deviceId:body.deviceId,updatedAt:Date.now(),choiceAt:body.intentAt||Date.now()};return json({accepted:true,session,serverTime:Date.now(),protocol:1});
   }
   return notAllowed(path,method);
  }
  if(path==='/api/v2/feed/hero'&&method==='GET')return json({item:{track:catalog.tracks[0],lane:'similar',reason:'Synthetic performance recommendation.'},generatedAt,refreshAt:Date.now()+600000});
  if(path==='/api/v2/feed'&&method==='GET'){
   const cursor=Number(parsed.searchParams.get('cursor')||0);if(!Number.isSafeInteger(cursor)||cursor<0||cursor>catalog.tracks.length)return json({error:'Invalid synthetic cursor'},400);
   const end=Math.min(catalog.tracks.length,cursor+pageSize);return json({items:catalog.tracks.slice(cursor,end).map(track=>({track,lane:'similar',reason:'A synthetic recommendation for checking performance.'})),sections:[],nextCursor:end<catalog.tracks.length?String(end):null,totalCandidates:catalog.tracks.length,personalized:true,generatedAt,...(parsed.searchParams.get('includeHero')==='1'&&!parsed.searchParams.has('cursor')?{hero:{item:{track:catalog.tracks[0],lane:'similar',reason:'Synthetic performance recommendation.'},generatedAt,refreshAt:Date.now()+600000}}:{})});
  }
  if(path==='/api/v2/home'&&method==='GET')return json({featured:catalog.tracks.slice(0,4),mixes:[],recent:[],needsOnboarding:false});
  if(path==='/api/v2/mixes'&&method==='GET')return json({mixes:[]});
  if(path==='/api/v2/bloom/shelf'&&method==='GET')return json({items:[]});
  if(path==='/api/v2/collection-view'){
   const room=method==='PATCH'?body.room:parsed.searchParams.get('room');if(typeof room!=='string')return json({error:'Missing synthetic room'},400);
   if(method==='PATCH')roomPreferences[room]={layout:body.layout,sort:body.sort,direction:body.direction,updatedAt:new Date().toISOString()};
   else if(method!=='GET')return notAllowed(path,method);
   return json({room,preference:roomPreferences[room]||null});
  }
  if(path==='/api/v2/recordings/resolve'&&method==='POST'){
   const track=catalog.tracks.find(track=>track.reference.id===body.reference?.id);if(!track)return json({error:'Unknown synthetic reference'},404);
   return json({status:'resolved',recording:track,playback:track.readyPlayback});
  }
  if(path==='/api/v2/lyrics'&&method==='GET')return json({timing:'synced',schemaVersion:'verified-lyrics-v3',provider:'fixture',providerTrackId:1,hasJapanese:false,lines:Array.from({length:18},(_,i)=>({start:i*5,end:(i+1)*5,text:'Performance fixture lyric '+i}))});
  if(path==='/api/v2/smart-queue'&&method==='POST')return json({tracks:[],reason:'Synthetic fixture'});
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path)&&method==='GET'){const track=catalog.tracks.find(track=>track.id===path.split('/').at(-1));return track?json({recording:track}):json({error:'Unknown synthetic song'},404);}
  return notAllowed(path,method);
 }
 return {handle,media,settings};
}
export async function installPerformanceFixture(context,{origin,account,catalog,pageSize=12,settings={},apiDelayMs=0,bootstrapDelayMs=0}){
 const base=localOrigin(origin),secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Local synthetic session signing configuration is required');
 const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 const api=performanceApi({account,catalog,pageSize,settings}),requests=[],unexpected=[],failed=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  if(url.hostname==='res.cloudinary.com'&&url.pathname.startsWith('/performance-fixture/'))return route.fulfill(api.media(request.headers(),method));
  if(url.origin!==base){unexpected.push({url:url.href,method,kind:'external'});return route.abort();}
  if(/^\/api(?:\/|$)/.test(path)){
   const record={path,query:url.search,method,at:Date.now()};requests.push(record);
   const response=api.handle({url:url.href,method,headers:request.headers(),body:['GET','HEAD'].includes(method)?{}:request.postDataJSON()});
   if(response.unexpected)unexpected.push(record);
   if(path==='/api/v2/bootstrap'&&bootstrapDelayMs)await pause(bootstrapDelayMs);else if(path.startsWith('/api/v2/feed')&&apiDelayMs)await pause(apiDelayMs);
   record.status=response.status;record.respondedAt=Date.now();return route.fulfill(response);
  }
  if(!['GET','HEAD'].includes(method)){unexpected.push({path,method,kind:'non-api mutation'});return route.abort();}
  return route.continue();
 });
 context.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')failed.push({url:request.url(),error:request.failure()?.errorText});});
 return {api,requests,unexpected,failed};
}
export function installPerformanceObservers(){
 const data=window.__sakuraPerformance={lcpMs:0,longTasks:[],events:[],frameInputs:[]};
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())data.lcpMs=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())data.longTasks.push({startMs:entry.startTime,durationMs:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.interactionId)data.events.push({name:entry.name,startMs:entry.startTime,durationMs:entry.duration,interactionId:entry.interactionId});}).observe({type:'event',durationThreshold:16,buffered:true});}catch{}
 document.addEventListener('input',event=>{const start=performance.now();requestAnimationFrame(()=>data.frameInputs.push({label:event.target.getAttribute?.('aria-label'),startMs:start,nextFrameMs:performance.now()-start}));},true);
}
export async function performanceSnapshot(page){
 return page.evaluate(()=>{
  const resources=performance.getEntriesByType('resource'),sum=(entries,key)=>entries.reduce((total,entry)=>total+(entry[key]||0),0);
  const summarize=entries=>({requests:entries.length,transferBytes:sum(entries,'transferSize'),encodedBytes:sum(entries,'encodedBodySize'),decodedBytes:sum(entries,'decodedBodySize'),cacheHits:entries.filter(entry=>entry.transferSize===0&&entry.decodedBodySize>0).length,paths:entries.map(entry=>new URL(entry.name).pathname)});
  const main=document.querySelector('#music-main');return {observedMs:performance.now(),javascript:summarize(resources.filter(entry=>new URL(entry.name).pathname.endsWith('.js'))),css:summarize(resources.filter(entry=>new URL(entry.name).pathname.endsWith('.css'))),images:summarize(resources.filter(entry=>entry.initiatorType==='img')),fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,lcpMs:window.__sakuraPerformance?.lcpMs||null,longTasks:window.__sakuraPerformance?.longTasks||[],interactionEvents:window.__sakuraPerformance?.events||[],inputFrames:window.__sakuraPerformance?.frameInputs||[],fit:!!main&&main.scrollWidth<=main.clientWidth+1,domElements:document.getElementsByTagName('*').length};
 });
}
export async function performanceStorageSnapshot(page,accountId){
 return page.evaluate(async owner=>{
  const preference=JSON.parse(localStorage.getItem('sakura-v2-preferences:'+owner)||'null');
  const stored=await new Promise((resolve,reject)=>{
   const request=indexedDB.open('sakura-ink-v1',1);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('entries')){db.close();resolve([]);return;}const tx=db.transaction('entries','readonly'),keys=tx.objectStore('entries').getAllKeys();keys.onsuccess=()=>{resolve(keys.result.filter(key=>String(key).startsWith('account:'+owner+':recommendation-view:')).map(String));};tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error);};};request.onerror=()=>reject(request.error);
  });
  return {activeAccount:localStorage.getItem('sakura-v2-active-account'),preferencePersisted:!!preference?.settings,preferencePending:preference?.pending===true,recommendationKeys:stored};
 },accountId);
}
export async function feedReady(page,{surface='home',tracks,count=Math.min(12,tracks.length)}){
 const room=page.locator(`[data-personalized-feed="${surface}"]`),hero=room.locator('[data-hero-music] [data-song-id]'),feed=room.locator('section[aria-label$="song feed"] [data-song-id]');
 // Current feed reserves one recommendation for the hero; detect that exact
 // membership instead of accepting any fallback/empty screen as readiness.
 await page.waitForFunction(({surface,title})=>document.querySelector(`[data-personalized-feed="${surface}"] [data-hero-music]`)?.textContent.includes(title),{surface,title:tracks[0].title});
 await hero.waitFor({state:'visible'});await page.waitForFunction(({surface,count})=>document.querySelectorAll(`[data-personalized-feed="${surface}"] section[aria-label$="song feed"] [data-song-id]`).length>=count,{surface,count});
 return {room,hero,feed};
}
export function validatePerformanceFixture(){
 const account={id:'90000000-0000-4000-8000-000000000086',username:'Contract fixture',email:'fixture@example.invalid'},catalog=performanceCatalog({count:80}),api=performanceApi({account,catalog});
 assert.equal(api.handle({url:'/api/v2/bootstrap'}).json.profile.id,account.id);
 const settings=api.handle({url:'/api/v2/settings'}).json;assert.equal(settings.revision,0);assert.equal(settings.fieldRevisions.volume,0);
 assert.equal(api.handle({url:'/api/v2/settings',method:'PATCH',body:{volume:.2,expectedRevision:0}}).json.revision,1);
 assert.equal(api.handle({url:'/api/v2/settings',method:'PATCH',body:{volume:.3,expectedRevision:0}}).status,409);
 const first=api.handle({url:'/api/v2/feed?surface=home'}).json,next=api.handle({url:'/api/v2/feed?cursor='+first.nextCursor}).json;assert.equal(first.items.length,12);assert.equal(next.items[0].track.id,catalog.tracks[12].id);
 const media=api.handle({url:catalog.tracks[0].readyPlayback.fallbackUrl,headers:{range:'bytes=44-100'}});assert.equal(media.status,206);assert.equal(media.body.length,57);assert.equal(media.headers['Content-Range'],`bytes 44-100/${catalog.wav.length}`);assert.equal(catalog.tracks[0].readyPlayback.sha256,createHash('sha256').update(catalog.wav).digest('hex'));
 const state={queue:[],currentEntryId:null,positionMs:0,sleepUntil:null},put=api.handle({url:'/api/v2/listening-session',method:'PUT',body:{state,revision:0,deviceId:account.id}}).json;assert.equal(put.accepted,true);assert.equal(put.session.revision,1);assert.equal(api.handle({url:'/api/v2/listening-session',method:'PUT',body:{state,revision:0,deviceId:account.id}}).json.accepted,false);
 assert.equal(api.handle({url:'/api/v2/unknown'}).unexpected,true);assert.equal(api.handle({url:'/api/v2/settings',headers:{'x-sakura-account':'other'}}).status,401);
 return {fixtureVersion:PERFORMANCE_FIXTURE_VERSION,bootstrap:true,revisions:true,pagination:true,fingerprintedRanges:true,sessionReceipts:true,unknownRoutesRejected:true,accountIsolation:true};
}
