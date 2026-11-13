/** Real UI; synthetic English lyrics/audio and intercepted hosted-worker jobs.
 * No model is downloaded and no real audio or account mutation leaves the test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import ts from 'typescript';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';
import {performanceApi} from './fixtures/performance-browser.mjs';

const target=new URL(process.env.SAKURA_TEST_URL||'http://localhost:3000'),expect=baseExpect.configure({timeout:20000});
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.pathname==='/'&&!target.username&&!target.password&&!target.search&&!target.hash,'Auto sync browser fixture requires a loopback build');
const base=target.origin;
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local fixture authentication signing configuration is required');
const account={id:'94010000-0000-4000-8000-000000000401',username:'Sync fixture',email:'sync@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const versions=await fs.readFile('src/rebuild/lyrics/versions.ts','utf8'),version=versions.match(/VERIFIED_LYRICS_VERSION\s*=\s*"([^"]+)"/)[1];
const wav=Buffer.alloc(44+8000*40*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['A clear English song','Another English song'].map((title,index)=>({
 id:`95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`,title,artists:['Sync fixture'],artistId:null,albumId:null,albumTitle:'Audio analysis fixtures',durationMs:40000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(index+401)},references:[{provider:'deezer',id:String(index+401)}],
 readyPlayback:{kind:'stream',delivery:'cdn',assetId:`96010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:40000,url:`https://res.cloudinary.com/sync-fixture/video/upload/v1/sakura/v2/audio/95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}/audio?assetId=96010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`},
}));
const lines=[{text:'Hello world',start:0},{text:'We are here',start:0}];
const settings={theme:'light',audioTechnology:'none',audioQuality:'balanced',privateSession:true,learnFromListening:false,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],seedArtistSelections:[],discovery:.4,volume:.4,shuffle:false,repeat:'off',timeZone:'Africa/Lagos',revision:1,fieldRevisions:{}};
const backgroundApi=performanceApi({account,catalog:{tracks,wav},settings});
const sessionFunctions={};
new Function('exports',ts.transpileModule(await fs.readFile('src/rebuild/app/sessionState.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(sessionFunctions);
const report={scope:'Production UI; intercepted synthetic audio and jobs, simulated visibility events, native browser offline/online events; no live account/provider writes',checks:[],errors:[]};
await fs.mkdir('.local/auto-sync-browser',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(({account,settings})=>{sessionStorage.setItem('sakura-ink-opening','1');localStorage.setItem('sakura-v2-active-account',account.id);localStorage.setItem('sakura-v2-preferences:'+account.id,JSON.stringify({settings,pending:false,savedAt:Date.now()}));},{account,settings});
 let mode='complete',session=null,held=[],started=0,polls=0;
 const syncRequests=[],apiRequests=[],externalRequests=[];
 const modelRequests=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/'||path.startsWith('/s/'))return route.abort('blockedbyclient');
  if(url.hostname==='huggingface.co'||url.hostname==='cdn.jsdelivr.net'){modelRequests.push(request.url());return route.abort();}
  if(url.hostname==='res.cloudinary.com'||/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path)){
   const range=request.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
   if(start>=wav.length)return route.fulfill({status:416,headers:{'Content-Range':'bytes */'+wav.length}});
   return route.fulfill({status:range?206:200,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})}});
  }
  if(url.origin!==base){externalRequests.push(request.url());return route.abort('blockedbyclient');}
  if(!path.startsWith('/api/'))return route.continue();
  apiRequests.push({path,method:request.method()});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account,expires:'2099-01-01T00:00:00.000Z'}});
  if(path==='/api/v2/bootstrap')return route.fulfill({json:{profile:account}});
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[],topSongs:[],insights:{topSongs:[]}}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:Object.fromEntries(tracks.map(track=>[track.id,{liked:true,revision:1}]))}});
  if(path==='/api/v2/settings')return route.fulfill({json:settings});
  if(path==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[]}});
  if(path==='/api/v2/collection-view')return route.fulfill({json:{preference:null}});
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:tracks}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){
    const data=request.postDataJSON();
    if(data.revision!==(session?.revision||0))return route.fulfill({json:{accepted:false,session,serverTime:Date.now(),protocol:2}});
    let state;
    if(data.checkpoint){assert.equal(data.checkpoint.queueKey,session?.queueKey);const {queueKey,...checkpoint}=data.checkpoint;void queueKey;state={...session.state,...checkpoint};}
    else{const raw=data.packed?JSON.parse(gunzipSync(Buffer.from(data.packed,'base64'),{maxOutputLength:1024*1024}).toString('utf8')):data.state;state=data.protocol===2?sessionFunctions.expandSessionState(raw):raw;}
    assert.ok(Array.isArray(state.queue)&&(state.currentEntryId===null||state.queue.some(entry=>entry.entryId===state.currentEntryId)));
    const updatedAt=Date.now(),choiceAt=data.explicit===false?(session?.choiceAt??updatedAt):updatedAt;
    session={state,revision:data.revision+1,deviceId:data.deviceId,updatedAt,choiceAt,queueKey:createHash('sha256').update(sessionFunctions.sessionQueueIdentity(state)).digest('hex')};
    return route.fulfill({json:{accepted:true,session,serverTime:Date.now(),protocol:2}});
   }
   return route.fulfill({json:{session,serverTime:Date.now(),protocol:2}});
  }
  if(path==='/api/v2/recordings/resolve'){const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,recordingId:track.id,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'matched',lines,timing:'plain',provider:'plain synthetic fixture',providerTrackId:401,schemaVersion:version}});
  if(path==='/api/v2/lyrics/sync'){
   const input=request.postDataJSON();
   syncRequests.push({method:request.method(),input,at:Date.now()});assert.equal(request.method(),'POST');
   if(input.recordingId){started++;assert.equal(input.lines.length,2);assert.ok(tracks.some(track=>track.id===input.recordingId));return route.fulfill({json:{status:'pending',phase:'queued',retryAfterMs:1000,jobToken:'fixture-job-'+started}});}
   assert.match(input.jobToken,/^fixture-job-\d+$/);
   polls++;
   if(mode==='held'){held.push(route);return;}
   if(mode==='error')return route.fulfill({status:503,json:{reason:'lyrics-sync-unavailable',error:'The free lyric worker has no remaining quota. Try again later.'}});
   return route.fulfill({json:{status:'complete',lines:[{text:'Hello world',start:2,end:4},{text:'We are here',start:7,end:9}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:createHash('sha256').update(JSON.stringify(lines.map(line=>line.text))).digest('hex')}}});
  }
  if(path==='/api/v2/search'&&request.method()==='GET'&&[...url.searchParams].length===2&&url.searchParams.get('q')==='Sync fixture'&&url.searchParams.get('searchVersion')==='2')return route.fulfill({json:{query:'Sync fixture',tracks,artists:[],albums:[],totals:{tracks:tracks.length,artists:0,albums:0},nextCursors:{tracks:null,artists:null,albums:null}}});
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]}});
  const method=request.method(),fallback=backgroundApi.handle({url:url.href,method,headers:request.headers(),body:['GET','HEAD'].includes(method)?{}:request.postDataJSON()});
  if(fallback.unexpected)report.errors.push('Unexpected fixture API '+method+' '+path);
  return route.fulfill(fallback);
 });
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).click();
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();
 const player=page.locator('dialog[data-dialog-appearance="player"]');await expect(player).toHaveAttribute('data-dialog-phase','open');
 await player.getByRole('button',{name:'Lyrics',exact:true}).click();
 const lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
 const sync=lyrics.getByRole('button',{name:'Auto sync',exact:true});await expect(sync).toBeVisible();
 // Exercise the shipped React button with real DOM visibility listeners. The
 // visibility state is explicitly synthetic so this does not claim OS/tab
 // suspension measurements; the offline/online state uses Chromium itself.
 const visibility=async hidden=>page.evaluate(hidden=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},hidden);
 mode='held';await sync.click();await expect.poll(()=>held.length).toBe(1);
 const acceptedToken=syncRequests.find(entry=>entry.input.jobToken).input.jobToken,acceptedStarts=started;
 await visibility(true);const hiddenPolls=polls;
 await page.waitForTimeout(1300);assert.equal(polls,hiddenPolls);assert.equal(started,acceptedStarts);
 await expect(lyrics.getByRole('button',{name:'Cancel auto sync',exact:true})).toHaveAttribute('aria-busy','true');
 await held.pop().fulfill({json:{status:'complete',lines:[{text:'Hello world',start:20,end:22},{text:'We are here',start:24,end:26}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:'hidden-obsolete'}}}).catch(()=>{});
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 await visibility(false);await expect.poll(()=>held.length).toBe(1);assert.equal(started,acceptedStarts);
 await context.setOffline(true);await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);const offlinePolls=polls;
 await page.waitForTimeout(1300);assert.equal(polls,offlinePolls);assert.equal(started,acceptedStarts);
 await held.pop().fulfill({json:{status:'complete',lines:[{text:'Hello world',start:20,end:22},{text:'We are here',start:24,end:26}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:'offline-obsolete'}}}).catch(()=>{});
 mode='held';await context.setOffline(false);await expect.poll(()=>held.length).toBe(1);assert.equal(started,acceptedStarts);
 assert.ok(syncRequests.filter(entry=>entry.input.jobToken).every(entry=>entry.input.jobToken===acceptedToken));
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 await lyrics.getByRole('button',{name:'Cancel auto sync',exact:true}).click();await held.pop().abort().catch(()=>{});await expect(sync).toBeVisible();
 report.checks.push('Hidden/offline polls stop and resume the same accepted token without another start or remote cancellation; late paused replies cannot replace plain words.');
 mode='held';await sync.click();await expect(lyrics.getByRole('button',{name:'Cancel auto sync',exact:true})).toHaveAttribute('aria-busy','true');
 await expect.poll(()=>held.length).toBe(1);
 await lyrics.getByRole('button',{name:'Cancel auto sync',exact:true}).click();await expect(sync).toBeVisible();
 await held.pop().fulfill({json:{status:'complete',lines:[{text:'Hello world',start:2,end:4},{text:'We are here',start:7,end:9}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:'canceled-fixture'}}}).catch(()=>{});
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 report.checks.push('Cancel suppresses a late worker result and keeps plain lyrics.');
 mode='complete';await sync.click();await expect(sync).toHaveCount(0);await expect(lyrics.getByText('Tap a line or press Enter to listen from that moment.',{exact:false})).toBeVisible();
 report.checks.push('Hosted result changes the existing lyric view to actual line timestamps.');
 await lyrics.getByRole('button',{name:'Next song',exact:true}).click();await expect(lyrics.locator('[data-auto-sync]')).toBeVisible();
 mode='error';await lyrics.getByRole('button',{name:'Auto sync',exact:true}).click();await expect(lyrics.locator('[data-auto-sync] [role="status"]')).toContainText(/quota|worker|temporar/i);
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 report.checks.push('Song changes reset sync state; worker failure keeps original plain words.');
 assert.deepEqual(modelRequests,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(report.errors,[]);
 assert.ok(syncRequests.every(entry=>entry.method==='POST'&&(entry.input.recordingId||Object.keys(entry.input).length===1&&entry.input.jobToken)),'No remote job cancellation request may be sent');
 report.checks.push('The browser fetched zero model files and uploaded zero audio files.');
 report.requests={started,polls,sync:syncRequests,api:apiRequests};
 await page.screenshot({path:'.local/auto-sync-browser/result.png'});
 await fs.writeFile('.local/auto-sync-browser/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=String(error);if(page)await page.screenshot({path:'.local/auto-sync-browser/failure.png'}).catch(()=>{});await fs.writeFile('.local/auto-sync-browser/failure-report.json',JSON.stringify(report,null,2)).catch(()=>{});throw error;}
finally{await browser.close();}
