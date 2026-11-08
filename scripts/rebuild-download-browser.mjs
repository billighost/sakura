/** Production pages, synthetic account APIs and real WAV bytes. Never writes to the database. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as playwrightExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=playwrightExpect.configure({timeout:30000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3015';
const progressiveOnly=process.argv.includes('--progressive')||process.env.SAKURA_PROGRESSIVE_ONLY==='1';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000071',username:'Download garden',email:'download-garden@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,discovery:.4,volume:.3,shuffle:false,repeat:'off',seedArtists:[],seedGenres:[]};
const titles=['A little morning','Paper lanterns — 花の道','Velvet after rain (Extended Mix)','The quiet between','Songs for tomorrow','A distant shore','Unavailable recording','A changing sky','Hold this moment'];
function tone(index){
 const rate=8000,seconds=180,samples=rate*seconds,buffer=Buffer.alloc(44+samples*2);
 buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*(220+index*37)/rate)*900),44+i*2);
 return {bytes:buffer,sha:createHash('sha256').update(buffer).digest('hex')};
}
const assets=titles.map((_,i)=>tone(i));
function cover(index){const hues=['#758b74','#c296a5','#817184','#d5b276','#89a1a1','#bd8d71','#88917c'];return 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${hues[index%hues.length]}"/><circle cx="275" cy="118" r="74" fill="#f6ead3" opacity=".8"/><path d="M0 310Q80 200 170 290T400 240V400H0" fill="#263f36" opacity=".45"/><path d="M90 400Q120 200 230 70M135 260Q30 205 67 174Q130 167 135 260M186 176Q295 155 276 117Q213 113 186 176" fill="none" stroke="#f6ead3" stroke-width="6"/><text x="32" y="62" font-family="Georgia" font-size="28" fill="#fff8e6">SAKURA / ${String(index+1).padStart(2,'0')}</text></svg>`);}
const tracks=titles.map((title,i)=>{
 const id=`80000000-0000-4000-8000-${String(i+71).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i+71).padStart(12,'0')}`,asset=assets[i];
 const track={id,recordingId:id,title,artists:[i===1?'花の庭':'The Garden Ensemble'],artistsComplete:true,artistId:null,albumId:null,albumTitle:['Small hours','花の庭','Rain studies'][i%3],durationMs:180000,coverUrl:cover(i),versionLabel:i===2?'Extended mix':'Original recording',reference:{provider:'deezer',id:String(i+71)},references:[{provider:'deezer',id:String(i+71)}]};
 if(i!==6)track.readyPlayback={kind:'stream',delivery:'cdn',assetId,sizeBytes:asset.bytes.length,sha256:asset.sha,mimeType:'audio/wav',durationMs:180000,url:`https://res.cloudinary.com/download-garden-fixture/video/upload/v1/sakura/v2/audio/${id}/${asset.sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`};
 return track;
});
const catalogAlias={...tracks[1],id:'deezer:'+tracks[1].reference.id,recordingId:'deezer:'+tracks[1].reference.id,readyPlayback:undefined};
const report={scope:'Built production pages with generated WAV bytes, intercepted account/catalog APIs and browser-only storage; no server database mutations',mode:progressiveOnly?'progressive-playback':'downloads-and-library',base,limitation:'Browser automation verifies mechanics and generated media, while the separate real-song audit verifies provider identity',checkedAt:new Date().toISOString(),checks:[],requests:[],pageErrors:[],unexpectedMutations:[],screenshots:[],issues:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
let context,page,session=null,delayMs=1200,forceSourceError=false,inFlight=0,maxInFlight=0;
const malformedRanges=new Set();
const failingMedia=new Set();
const perSong=new Map(),maxPerSong=new Map();
await fs.mkdir('.local',{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(message){report.checks.push(message);console.log(message);}
async function persisted(){
 return page.evaluate(async accountId=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readonly'),store=tx.objectStore('entries'),get=store.getAll(),keys=store.getAllKeys();tx.oncomplete=()=>resolve(get.result.map((value,index)=>({key:String(keys.result[index]),value})).filter(row=>row.key.startsWith('account:'+accountId+':')).map(({key,value})=>({key,status:value?.status,requested:value?.requested,trackId:value?.track?.id,recordingId:value?.recordingId,downloadedBytes:value?.downloadedBytes,sizeBytes:value?.sizeBytes,totalBytes:value?.totalBytes,sha256:value?.sha256,blobBytes:value?.blob instanceof Blob?value.blob.size:undefined,chunks:value?.chunks,ranges:value?.ranges,source:value?.source?{assetId:value.source.assetId,sizeBytes:value.source.sizeBytes,sha256:value.source.sha256}:undefined})));tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 },account.id);
}
async function seedSaved(index=0){
 const asset=assets[index];await page.evaluate(async input=>{
  const binary=atob(input.base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('entries'))request.result.createObjectStore('entries');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put({track:input.track,blob:new Blob([bytes],{type:'audio/wav'}),sizeBytes:bytes.length,sha256:input.sha,savedAt:Date.now()},'account:'+input.accountId+':audio:'+input.track.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 },{accountId:account.id,track:tracks[index],base64:asset.bytes.toString('base64'),sha:asset.sha});
}
async function verifySavedBytes(){
 const results=await page.evaluate(async accountId=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readonly'),store=tx.objectStore('entries'),values=store.getAll(),keys=store.getAllKeys();tx.oncomplete=()=>resolve(values.result.map((value,index)=>({key:String(keys.result[index]),value})).filter(row=>row.key.startsWith('account:'+accountId+':audio:')));tx.onerror=()=>reject(tx.error);});db.close();
  return Promise.all(rows.map(async({value})=>({id:value.track.id,size:value.blob.size,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await value.blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('')})));
 },account.id);
 for(const row of results){const index=tracks.findIndex(track=>track.id===row.id);assert.equal(row.size,assets[index].bytes.length);assert.equal(row.sha,assets[index].sha);}
 report.verifiedArtifacts=results;
}
async function go(path){
 try{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});}
 catch(error){if(!(error instanceof Error)||!error.message.includes('ERR_ABORTED'))throw error;await sleep(300);await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});}
 await screenReady(path);
}
async function screenReady(path){const title=path==='/library/downloaded'?'Your pocket of quiet.':path==='/library'?'Your little music world.':null;await expect(title?page.getByRole('heading',{name:title,exact:true}):page.locator('#music-main h1:visible').first()).toBeVisible();}
async function navigate(path){const link=page.locator('a[href="'+path+'"]').first();if(await link.count()){await link.click();await screenReady(path);await expect.poll(()=>new URL(page.url()).pathname).toBe(path);}else await go(path);}
async function download(index,repeats=1){
 const button=page.getByRole('button',{name:'Download '+tracks[index].title,exact:true}).first();await button.waitFor();await button.evaluate((element,count)=>{for(let i=0;i<count;i++)element.click();},repeats);
}
async function activity(){await page.getByRole('tab',{name:/^Activity/}).click();}
async function saved(){await page.getByRole('tab',{name:/^Saved songs/}).click();}
async function fit(label){const dimensions=await page.locator('#music-main').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`${label} overflow: ${JSON.stringify(dimensions)}`);const body=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(body.scroll<=body.width+1,`${label} page overflow: ${JSON.stringify(body)}`);}
async function screenshot(name){const path='.local/download-'+name+'.png';await page.screenshot({path});report.screenshots.push(path);}
async function controlWorker(){
 await page.evaluate(()=>Promise.race([navigator.serviceWorker.register('/sw.js'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fixture service-worker registration timed out')),15000))]));
 await expect.poll(async()=>{const state=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?{scriptURL:navigator.serviceWorker.controller.scriptURL,state:navigator.serviceWorker.controller.state}:null,registrations:(await navigator.serviceWorker.getRegistrations()).map(registration=>({scope:registration.scope,active:registration.active?{scriptURL:registration.active.scriptURL,state:registration.active.state}:null,installing:registration.installing?{scriptURL:registration.installing.scriptURL,state:registration.installing.state}:null,waiting:registration.waiting?{scriptURL:registration.waiting.scriptURL,state:registration.waiting.state}:null}))}));report.workerSetup=state;return !!state.controller;},{timeout:20000}).toBe(true);
}
async function progressiveState(){
 return page.evaluate(async accountId=>{
  const audio=window.downloadTestAudio,slider=document.querySelector('input[aria-label="Playback position"]');
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readonly'),store=tx.objectStore('entries'),values=store.getAll(),keys=store.getAllKeys();tx.oncomplete=()=>resolve(values.result.map((value,index)=>({key:String(keys.result[index]),value})));tx.onerror=()=>reject(tx.error);});db.close();
  return {src:audio?.src,hasSrc:audio?.hasAttribute('src'),time:audio?.currentTime,paused:audio?.paused,title:document.querySelector('[aria-label="Open now playing"] b')?.textContent,uiPositionMs:Number(slider?.value||0),lyric:document.querySelector('[data-mini-lyric]')?.textContent,alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(el=>el.textContent),grants:rows.filter(row=>row.key.startsWith('audio-bridge:')).map(({key,value})=>({key,recordingId:value.recordingId})),jobs:rows.filter(row=>row.key.startsWith('account:'+accountId+':download:')).map(({value})=>({id:value.recordingId,status:value.status,mode:value.mode,requested:value.requested})),chunks:rows.filter(row=>row.key.startsWith('account:'+accountId+':chunk:')).map(({key,value})=>({key,offset:value.offset,size:value.blob?.size||0})),ready:rows.filter(row=>row.key.startsWith('account:'+accountId+':audio:')).map(({value})=>({id:value.track.id,size:value.blob?.size,requested:value.requested,sha256:value.sha256}))};
 },account.id);
}
async function progressiveScenario(){
 report.stage='Opening the progressive fixture library';
 await go('/library');await seedSaved();await page.reload({waitUntil:'domcontentloaded'});await screenReady('/library');
 // The application registers its worker in production. Explicit local registration
 // also exercises the exact same worker on an isolated development server.
 report.stage='Waiting for a controlled service worker';await controlWorker();report.stage='Preparing queue prefixes';
 await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).first().click();
 await expect.poll(async()=>{const state=await progressiveState();return [1,2,3].every(index=>state.jobs.some(job=>job.id===tracks[index].id&&job.status==='prepared'&&job.requested===false));},{timeout:60000}).toBe(true);
 check('Queue playback prepares durable prefixes without publishing them as downloaded songs');
 delayMs=1400;await download(8);await page.getByRole('button',{name:'Play '+tracks[3].title,exact:true}).first().click();
 await expect.poll(()=>page.evaluate(()=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>2)).toBe(true);
 const player=()=>page.locator('footer').filter({has:page.getByRole('button',{name:'Open now playing',exact:true})});
 const beforePause=await progressiveState(),oldUrl=beforePause.src;report.progressive={beforePause};
 await player().getByRole('button',{name:'Pause',exact:true}).click();await sleep(100);const pauseMarker=report.requests.length;await sleep(900);const afterPause=await progressiveState();report.progressive.afterPause=afterPause;
 assert.equal(afterPause.hasSrc,false,'Progressive pause detaches its media source');assert.equal(afterPause.paused,true);assert.ok(afterPause.uiPositionMs>=1500&&Math.abs(afterPause.uiPositionMs-beforePause.time*1000)<500,`Pause keeps the displayed position: before ${beforePause.time*1000}, after ${afterPause.uiPositionMs}`);assert.equal(afterPause.lyric,beforePause.lyric,'Pause keeps the lyric at its preserved position');
 assert.ok(afterPause.jobs.some(job=>job.id===tracks[3].id&&job.mode==='prefix'&&job.requested===false),'Pause demotes the current automatic full job');assert.equal(afterPause.grants.length,0,'Pause revokes all prior playback grants');assert.equal(report.requests.slice(pauseMarker).some(row=>row.index===3&&row.resourceType==='fetch'),false,'Paused automatic playback does not launch more full-song chunks');
 const beforeExplicit=beforePause.chunks.filter(chunk=>chunk.key.includes(tracks[8].id)).reduce((sum,chunk)=>sum+chunk.size,0);await expect.poll(async()=>{const state=await progressiveState(),bytes=state.chunks.filter(chunk=>chunk.key.includes(tracks[8].id)).reduce((sum,chunk)=>sum+chunk.size,0);return bytes>beforeExplicit||state.ready.some(audio=>audio.id===tracks[8].id);},{timeout:10000}).toBe(true);
 assert.equal(await page.evaluate(async url=>(await fetch(url,{headers:{Range:'bytes=0-63'}})).status,oldUrl),404);check('Progressive pause preserves position and lyrics, revokes its grant and yields automatic work while explicit downloads continue');
 await page.evaluate(()=>{for(const name of ['timeupdate','waiting','playing','ended','error'])window.downloadTestAudio.dispatchEvent(new Event(name));});await sleep(150);const afterStaleSignals=await progressiveState();report.progressive.afterStaleSignals=afterStaleSignals;assert.equal(afterStaleSignals.uiPositionMs,afterPause.uiPositionMs,'Queued old media events cannot reset the preserved position');assert.equal(afterStaleSignals.title,afterPause.title,'An old ended event cannot skip the paused song');assert.deepEqual(afterStaleSignals.alerts,[],'Queued events after detaching media cannot show a playback failure');await expect(player().getByRole('button',{name:'Play',exact:true})).toBeVisible();check('Late media events after pause preserve the paused position and status');
 await player().getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>page.evaluate(position=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>position/1000+.5,afterPause.uiPositionMs)).toBe(true);const afterResume=await progressiveState();report.progressive.afterResume=afterResume;assert.notEqual(afterResume.src,oldUrl,'Resume creates a fresh capability');assert.ok(afterResume.uiPositionMs>afterPause.uiPositionMs);check('Resume recreates progressive media at the preserved listening position');
 const resumeUrl=afterResume.src;await player().getByRole('button',{name:'Next song',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>.5)).toBe(true);await sleep(250);const afterSkip=await progressiveState();report.progressive.afterSkip=afterSkip;assert.ok(afterSkip.jobs.some(job=>job.id===tracks[3].id&&job.mode==='prefix'&&job.requested===false)||afterSkip.ready.some(audio=>audio.id===tracks[3].id&&audio.requested===false),'Skipped automatic work yields to the next recording');assert.ok(afterSkip.grants.every(grant=>grant.recordingId!==tracks[3].id));assert.equal(await page.evaluate(async url=>(await fetch(url,{headers:{Range:'bytes=0-63'}})).status,resumeUrl),404);check('Skipping revokes the old progressive source and yields its automatic download to the next song');
 await player().getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[8].id&&audio.requested===true);},{timeout:60000}).toBe(true);const finalState=await progressiveState();report.progressive.finalState=finalState;const explicit=finalState.ready.find(audio=>audio.id===tracks[8].id);assert.equal(explicit.size,assets[8].bytes.length);assert.equal(explicit.sha256,assets[8].sha);check('The independently requested song finishes and verifies after progressive playback pauses and skips');await screenshot('progressive-paused-desktop');
 // Hold only the transaction-completion callback of an automatic finalization.
 // The bytes are committed, but the manager still awaits completion when the
 // user promotes the same recording through its catalog alias.
 await page.evaluate(()=>window.downloadFinalizeGate.armed=true);delayMs=120;await page.getByRole('button',{name:'Play '+tracks[1].title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.downloadFinalizeGate.reached),{timeout:60000}).toBe(true);
 report.progressive.beforeLatePromotion=await progressiveState();await page.locator('[data-song-id="'+catalogAlias.id+'"]').getByRole('button',{name:'Download '+tracks[1].title,exact:true}).click();
 await navigate('/library/downloaded');await activity();await expect(page.locator('[data-download-status]').filter({hasText:tracks[1].title})).toBeVisible();await player().getByRole('button',{name:'Pause',exact:true}).click();await saved();await expect(page.locator('[data-current-save-status="saving"]:visible')).toBeVisible();await screenshot('explicit-late-save-pending');
 await page.evaluate(()=>window.downloadFinalizeGate.release());await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[1].id&&audio.requested===true);},{timeout:60000}).toBe(true);await expect(page.getByRole('tabpanel').getByRole('button',{name:'Play '+tracks[1].title,exact:true})).toBeVisible();await expect(page.locator('[data-current-save-status]:visible')).toHaveCount(0);
 await page.close();page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));await go('/library/downloaded');await expect(page.getByRole('tabpanel').getByRole('button',{name:'Play '+tracks[1].title,exact:true})).toBeVisible();report.progressive.afterLatePromotionReopen=await progressiveState();check('A late explicit save through a canonical alias becomes visible, survives pause and persists as Saved after closing and reopening the app tab');
 await navigate('/library');await controlWorker();await page.getByRole('button',{name:'Play '+tracks[2].title,exact:true}).first().click();await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[2].id&&audio.requested===false);},{timeout:60000}).toBe(true);
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();const fullscreenDownload=page.getByRole('dialog').getByRole('button',{name:'Download this recording',exact:true});await expect(fullscreenDownload).toBeEnabled();await fullscreenDownload.click();await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[2].id&&audio.requested===true);},{timeout:30000}).toBe(true);await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await go('/library/downloaded');await expect(page.getByRole('tabpanel').getByRole('button',{name:'Play '+tracks[2].title,exact:true})).toBeVisible();check('Fullscreen explicitly saves a completed automatic cache and the verified recording remains Saved after reopening');
 await navigate('/library');await controlWorker();delayMs=600;await page.getByRole('button',{name:'Play '+tracks[5].title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>.4)).toBe(true);await page.getByRole('button',{name:'Open now playing',exact:true}).click();const activeFullscreenDownload=page.getByRole('dialog').getByRole('button',{name:'Download this recording',exact:true});await expect(activeFullscreenDownload).toBeEnabled();await activeFullscreenDownload.click();await expect.poll(async()=>{const state=await progressiveState();return state.jobs.some(job=>job.id===tracks[5].id&&job.requested===true&&job.mode==='full')||state.ready.some(audio=>audio.id===tracks[5].id&&audio.requested===true);}).toBe(true);await page.getByRole('dialog').getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Play '+tracks[4].title,exact:true}).first().click();await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[5].id&&audio.requested===true);},{timeout:60000}).toBe(true);check('Fullscreen promotes an active automatic stream to an explicit download that finishes after playback pauses and moves on');
 await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[4].id&&audio.requested===false);},{timeout:60000}).toBe(true);await page.getByRole('button',{name:'More options for '+tracks[4].title,exact:true}).first().click();const menuSave=page.getByRole('menuitem',{name:'Save on this device',exact:true});await expect(menuSave).toBeEnabled();await menuSave.click();await expect.poll(async()=>{const state=await progressiveState();return state.ready.some(audio=>audio.id===tracks[4].id&&audio.requested===true);},{timeout:30000}).toBe(true);await player().getByRole('button',{name:'Pause',exact:true}).click();await go('/library/downloaded');for(const index of [4,5])await expect(page.getByRole('tabpanel').getByRole('button',{name:'Play '+tracks[index].title,exact:true})).toBeVisible();check('Song options promote a completed automatic cache to a durable Saved song');await verifySavedBytes();
 await navigate('/library');delayMs=1400;await page.getByRole('button',{name:'Play '+tracks[7].title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>1)).toBe(true);
 const beforeFailure=await progressiveState();report.progressive.beforeFailure=beforeFailure;failingMedia.add(7);await page.evaluate(()=>window.downloadTestAudio.dispatchEvent(new Event('error')));
 await expect.poll(async()=>{const state=await progressiveState();report.progressive.afterFailure=state;return state.hasSrc===false&&state.grants.every(grant=>grant.recordingId!==tracks[7].id);}).toBe(true);await expect(player().getByRole('button',{name:'Play',exact:true})).toBeVisible();const afterFailure=await progressiveState();report.progressive.afterFailure=afterFailure;assert.ok(afterFailure.jobs.some(job=>job.id===tracks[7].id&&job.mode==='prefix'&&job.requested===false),'Terminal playback failure yields automatic full-file work');assert.ok(afterFailure.uiPositionMs>=beforeFailure.time*1000-500,'Fallback failure preserves the last audible position');
 const failureMarker=report.requests.length;await sleep(1600);assert.equal(report.requests.slice(failureMarker).some(row=>row.index===7&&row.resourceType==='fetch'),false,'Terminal failure cannot launch further automatic full-file chunks');assert.equal(await page.evaluate(async url=>(await fetch(url,{headers:{Range:'bytes=0-63'}})).status,beforeFailure.src),404);check('A failed progressive source and rejected media fallback revoke access, preserve the retry position and yield automatic downloads');
 failingMedia.delete(7);await player().getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>page.evaluate(position=>window.downloadTestAudio?.src.includes('/_sakura/audio/')&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>position/1000+.5,afterFailure.uiPositionMs)).toBe(true);const afterFailureRetry=await progressiveState();report.progressive.afterFailureRetry=afterFailureRetry;assert.notEqual(afterFailureRetry.src,beforeFailure.src);await player().getByRole('button',{name:'Pause',exact:true}).click();check('Play retries the failed progressive recording from its preserved position with a fresh grant');
}
async function audio(route){
 const request=route.request(),url=new URL(request.url()),index=tracks.findIndex(track=>url.pathname.includes(track.id));if(index<0)return route.abort();
 const asset=assets[index],range=request.headers().range?.match(/^bytes=(\d+)-(\d*)$/),isDownload=request.resourceType()!=='media',start=range?Number(range[1]):0,end=range&&range[2]?Math.min(asset.bytes.length-1,Number(range[2])):asset.bytes.length-1;
 const record={at:Date.now(),index,start,end,range:!!range,resourceType:request.resourceType(),finished:false};report.requests.push(record);
 if(isDownload){inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);perSong.set(index,(perSong.get(index)||0)+1);maxPerSong.set(index,Math.max(maxPerSong.get(index)||0,perSong.get(index)));}
 try{
  if(isDownload&&delayMs)await sleep(delayMs);
  if(!isDownload&&failingMedia.has(index))return await route.fulfill({status:503,json:{error:'Fixture media temporarily unavailable'}});
  if(forceSourceError&&isDownload)return await route.fulfill({status:503,json:{error:'Fixture transfer temporarily unavailable'}});
  const headers={'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'ETag':'"'+asset.sha+'"','Access-Control-Allow-Origin':base,'Access-Control-Expose-Headers':'Content-Length, Content-Range, ETag, Accept-Ranges'};
  if(start>=asset.bytes.length||end<start)return await route.fulfill({status:416,headers:{'Content-Range':`bytes */${asset.bytes.length}`}});
  if(range)headers['Content-Range']=`bytes ${start+(malformedRanges.has(index)?1:0)}-${end}/${asset.bytes.length}`;
  await route.fulfill({status:range?206:200,contentType:'audio/wav',headers,body:asset.bytes.subarray(start,end+1)});record.finished=true;
 }catch{/* Closing or reloading a page intentionally interrupts uncommitted chunks. */}
 finally{if(isDownload){inFlight--;perSong.set(index,(perSong.get(index)||1)-1);}}
}
try{
 context=await browser.newContext({viewport:{width:1440,height:960},colorScheme:'light',serviceWorkers:progressiveOnly?'allow':'block'});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(input=>{
  sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.Audio=function(...args){const element=new NativeAudio(...args);window.downloadTestAudio=element;return element;};window.Audio.prototype=NativeAudio.prototype;
  if(!input.progressive)return;
  let release;const gate={target:input.target,armed:false,reached:false,released:false,promise:new Promise(resolve=>release=resolve),release:()=>{gate.released=true;release();}};window.downloadFinalizeGate=gate;
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(gate.armed&&String(key).endsWith(':audio:'+gate.target)&&value?.requested===false){gate.armed=false;this.transaction.downloadFinalizationGate=gate;}return put.call(this,value,key);};
  const add=IDBTransaction.prototype.addEventListener;IDBTransaction.prototype.addEventListener=function(type,listener,options){if(type!=='complete'||!listener)return add.call(this,type,listener,options);return add.call(this,type,event=>{const current=this.downloadFinalizationGate;const invoke=()=>typeof listener==='function'?listener.call(this,event):listener.handleEvent(event);if(current&&!current.released){current.reached=true;void current.promise.then(invoke);}else invoke();},options);};
 },{progressive:progressiveOnly,target:tracks[1].id});
 await context.route('https://res.cloudinary.com/download-garden-fixture/**',audio);
 await context.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.headers()['x-sakura-account']&&request.headers()['x-sakura-account']!==account.id)return route.fulfill({status:401,json:{error:'Account changed'}});
  if(/\/recordings\/[^/]+\/audio$/.test(path))return audio(route);
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings'){if(request.method()==='PATCH')Object.assign(settings,request.postDataJSON());return route.fulfill({json:settings});}
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:progressiveOnly?[...tracks,catalogAlias]:tracks,playlists:[{id:'72000000-0000-4000-8000-000000000071',name:'Notes from the garden',trackCount:6,coverUrl:cover(1)}]}});
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){const data=request.postDataJSON();if((session?.revision||0)!==data.revision)return route.fulfill({json:{accepted:false,session,serverTime:Date.now()}});session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   return route.fulfill({json:{session,serverTime:Date.now()}});
  }
  if(path==='/api/v2/recordings/resolve'){
   const track=tracks.find(t=>t.reference.id===request.postDataJSON().reference.id);if(!track||!track.readyPlayback)return route.fulfill({status:409,json:{status:'review',reason:'no-exact-source',candidates:[]}});
   return route.fulfill({json:{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});
  }
  if(path==='/api/v2/lyrics'){
   const id=new URL(request.url()).searchParams.get('recordingId'),index=tracks.findIndex(t=>t.id===id);report.requests.push({at:Date.now(),kind:'lyrics',index});
   const lines=index===1?[{start:0,end:1,text:'花の道を歩いて'},{start:1,end:60,text:'また明日、歌おう'}]:[{start:0,end:1,text:'A little light in the morning'},{start:1,end:60,text:'Keep the garden in your song'}];
   return route.fulfill({json:{lines,timing:'synced',provider:'browser-fixture',providerTrackId:71+index,schemaVersion:'browser-fixture',hasJapanese:index===1}});
  }
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(t=>t.id===path.split('/').at(-1))||tracks[0]}});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(!['GET','HEAD'].includes(request.method())){report.unexpectedMutations.push({path,method:request.method()});return route.fulfill({status:503,json:{error:'Unexpected fixture mutation'}});}
  return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
 });
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 if(progressiveOnly){await progressiveScenario();}else{
 await go('/library/downloaded');await seedSaved();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).first().waitFor();
 await expect(page.getByRole('tab',{name:/^Saved songs/})).toHaveAttribute('aria-selected','true');check('Downloads opens on completed songs and restores a verified browser artifact');
 await screenshot('saved-desktop-light');

 await go('/library');await download(1,5);await expect.poll(()=>report.requests.filter(r=>r.index===1&&r.resourceType==='fetch').length).toBeGreaterThan(0);
 await download(2);await expect.poll(async()=>{const rows=await persisted();return rows.some(row=>row.key.includes(':chunk:'+tracks[1].id+':'));}).toBe(true);await go('/library/downloaded');await activity();
 await page.getByRole('button',{name:'Pause download of '+tracks[1].title,exact:true}).click();
 await expect(page.locator('[data-download-status="paused"]').filter({hasText:tracks[1].title})).toBeVisible();
 const pausedRows=await persisted(),pausedEntry=pausedRows.find(row=>row.trackId===tracks[1].id&&!row.key.includes(':audio:'));
 assert.ok(pausedEntry,'The paused job is durable');check('Repeated download clicks keep one job; simultaneous songs persist independently and pause retains partial bytes');
 await saved();await expect(page.getByRole('button',{name:'Play '+tracks[1].title,exact:true})).toHaveCount(0);check('Incomplete songs stay out of the default saved-song collection');
 await activity();await page.getByRole('button',{name:'Resume download of '+tracks[1].title,exact:true}).click();
 await expect.poll(async()=>{const rows=await persisted();return rows.some(row=>row.key.includes(':chunk:'+tracks[1].id+':'));}).toBe(true);
 const beforeReload=report.requests.length;await page.close();page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));await go('/library/downloaded');await activity();
 await expect.poll(()=>report.requests.slice(beforeReload).filter(row=>row.index===1&&row.resourceType==='fetch').length).toBeGreaterThan(0);
 const resumedRequests=report.requests.slice(beforeReload).filter(row=>row.index===1&&row.resourceType==='fetch');assert.ok(resumedRequests.some(row=>row.start>0),'Reload resumes missing chunks instead of restarting every request at byte zero');
 check('Closing and reopening the app restores the active request and resumes ranged bytes from saved partial data');
 delayMs=50;await expect.poll(async()=>{const rows=await persisted();return rows.filter(row=>row.key.includes(':audio:')).length;},{timeout:60000}).toBe(3);
 const artifacts=(await persisted()).filter(row=>row.key.includes(':audio:'));for(const row of artifacts){const index=tracks.findIndex(track=>track.id===row.trackId);assert.equal(row.blobBytes,assets[index].bytes.length);assert.equal(row.sha256,assets[index].sha);}
 assert.ok(Math.max(...maxPerSong.values())>1,'At least two disjoint chunks of the same song transfer concurrently');assert.ok(maxInFlight>1,'Multiple transfers operate concurrently');
 check('Parallel chunks finish as exactly sized, SHA-256-verified artifacts for all three recordings');
 await saved();await screenshot('saved-three-songs-desktop');
 const savedTab=page.getByRole('tab',{name:/^Saved songs/});await savedTab.focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:/^Activity/})).toHaveAttribute('aria-selected','true');await page.keyboard.press('Home');await expect(savedTab).toHaveAttribute('aria-selected','true');
 const savedSearch=page.getByRole('searchbox',{name:'Find a downloaded song',exact:true});await savedSearch.fill('花の道');await expect(page.getByRole('tabpanel').locator('[data-track-layout]').getByRole('button',{name:/^Play /})).toHaveCount(1);await page.getByRole('button',{name:'Clear find a downloaded song',exact:true}).click();await expect(savedSearch).toHaveValue('');await expect(savedSearch).toBeFocused();check('Downloads tabs support keyboard navigation and multilingual search clears back to saved music');

 await go('/library');await page.getByRole('button',{name:'Cards layout',exact:true}).click();await expect(page.getByRole('button',{name:'Cards layout',exact:true})).toHaveAttribute('aria-pressed','true');await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Cards layout',exact:true})).toHaveAttribute('aria-pressed','true');await screenshot('library-cards-desktop');await page.locator('[data-track-layout]').scrollIntoViewIfNeeded();await screenshot('library-cards-grid-desktop');
 await page.getByRole('button',{name:'Compact layout',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Compact layout',exact:true})).toHaveAttribute('aria-pressed','true');check('Library cards and compact layouts survive reopening');
 await page.getByRole('button',{name:'List layout',exact:true}).click();await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).first().click();
 await expect.poll(()=>page.evaluate(()=>({playing:!window.downloadTestAudio?.paused,time:window.downloadTestAudio?.currentTime||0}))).toMatchObject({playing:true});
 await expect(page.locator('footer').filter({has:page.getByRole('button',{name:'Open now playing',exact:true})}).getByText('Keep the garden in your song',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open lyrics',exact:true}).click();await page.getByRole('dialog').waitFor();const lyricsBefore=report.requests.filter(row=>row.kind==='lyrics'&&row.index===0).length;assert.equal(lyricsBefore,1,'Mini player and full lyrics reuse one verified lyric request');await page.getByRole('dialog').getByRole('button',{name:/Close/}).first().click();
 await page.getByRole('button',{name:'Play '+tracks[1].title,exact:true}).first().click();await expect(page.locator('footer').filter({has:page.getByRole('button',{name:'Open now playing',exact:true})}).getByText('また明日、歌おう',{exact:true})).toBeVisible();
 await expect(page.locator('footer').filter({has:page.getByRole('button',{name:'Open now playing',exact:true})}).getByText('Keep the garden in your song',{exact:true})).toHaveCount(0);check('Mini player follows synced multilingual lyric timestamps, shares full-player requests and clears previous-song words');

 delayMs=1800;for(const index of [3,4,5])await download(index);await navigate('/library/downloaded');await activity();await page.getByRole('button',{name:'Pause all',exact:true}).click();
 for(const index of [3,4,5])await expect(page.getByRole('button',{name:'Resume download of '+tracks[index].title,exact:true})).toBeVisible();
 const pauseMarker=report.requests.length;
 await page.getByRole('button',{name:'Open queue',exact:true}).first().click();const moveEarlier=page.getByRole('dialog').getByRole('button',{name:'Move '+tracks[5].title+' earlier',exact:true});await moveEarlier.click();await moveEarlier.click();report.priorityQueue=await page.getByRole('dialog').locator('[data-queue-entry] strong').allTextContents();assert.ok(report.priorityQueue.indexOf(tracks[5].title)<report.priorityQueue.indexOf(tracks[3].title),'Queue edit actually puts song5 ahead of song3');await page.getByRole('dialog').getByRole('button',{name:'Back to listening',exact:true}).click();
 for(const index of [3,4,5])await expect(page.getByRole('button',{name:'Resume download of '+tracks[index].title,exact:true})).toBeVisible();await sleep(400);assert.equal(report.requests.slice(pauseMarker).some(row=>[3,4,5].includes(row.index)&&row.resourceType==='fetch'),false,'Paused jobs do not restart through stale retries or queue prefetch');
 const priorityMarker=report.requests.length;await page.getByRole('button',{name:'Resume all',exact:true}).click();await expect.poll(()=>report.requests.slice(priorityMarker).filter(row=>[3,4,5].includes(row.index)&&row.resourceType==='fetch').length).toBeGreaterThan(0);
 const firstPriorityRequest=report.requests.slice(priorityMarker).find(row=>[3,4,5].includes(row.index)&&row.resourceType==='fetch');report.firstPriorityRequest=firstPriorityRequest;if(firstPriorityRequest.index!==5)report.issues.push('The newly earlier queue song should begin its next chunk before the other resumed songs; received song '+firstPriorityRequest.index);
 delayMs=50;await expect.poll(async()=>{const rows=await persisted();return rows.filter(row=>row.key.includes(':audio:')).length;},{timeout:60000}).toBe(6);check('Queue reordering changes the next download priority while all requested songs still finish');
 // Empty the upcoming queue before isolated failure/cancellation tests.
 await page.getByRole('button',{name:'Open queue',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Clear queue',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Back to listening',exact:true}).click();
 await go('/library');malformedRanges.add(7);await download(7);await download(6);await go('/library/downloaded');await activity();
 for(const index of [7,6])await expect(page.getByRole('button',{name:'Dismiss failed download of '+tracks[index].title,exact:true})).toBeVisible();
 await screenshot('activity-errors-desktop');
 await page.getByRole('button',{name:'Dismiss failed download of '+tracks[6].title,exact:true}).click();await expect(page.locator('[data-download-status="failed"]').filter({hasText:tracks[6].title})).toHaveCount(0);
 malformedRanges.delete(7);await page.getByRole('button',{name:'Retry download of '+tracks[7].title,exact:true}).click();await expect.poll(async()=>{const rows=await persisted();return rows.some(row=>row.key==='account:'+account.id+':audio:'+tracks[7].id);},{timeout:60000}).toBe(true);
 check('Both unavailable and invalid-range errors have independent dismiss controls; retry saves the correct file after recovery');
 delayMs=1500;await go('/library');await download(8);await expect.poll(()=>report.requests.filter(row=>row.index===8&&row.resourceType==='fetch').length).toBeGreaterThan(0);await go('/library/downloaded');await activity();await page.getByRole('button',{name:'Cancel download of '+tracks[8].title,exact:true}).click();await expect.poll(async()=>{const rows=await persisted();return rows.some(row=>row.key.includes(tracks[8].id));}).toBe(false);await sleep(1700);assert.equal((await persisted()).some(row=>row.key.includes(tracks[8].id)),false);check('Cancel clears only its own partial job and interrupted chunk responses cannot publish a late artifact');
 delayMs=50;await saved();const offlineRequestMarker=report.requests.length;await context.setOffline(true);await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>!!window.downloadTestAudio&&!window.downloadTestAudio.paused&&window.downloadTestAudio.currentTime>.2&&window.downloadTestAudio.src.startsWith('blob:'))).toBe(true);await context.setOffline(false);assert.equal(report.requests.slice(offlineRequestMarker).some(row=>row.resourceType==='media'),false);check('A completed song plays its verified browser blob offline without an audio network request');

 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await go('/library/downloaded');await saved();await fit('Saved songs '+width+'px');await screenshot('saved-mobile-'+width+'-light');
  await go('/library');await page.getByRole('button',{name:'Cards layout',exact:true}).click();await fit('Library cards '+width+'px');await screenshot('library-cards-mobile-'+width+'-light');await page.locator('[data-track-layout]').scrollIntoViewIfNeeded();await screenshot('library-grid-mobile-'+width+'-light');
  await page.getByRole('button',{name:'Change appearance',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.inkTheme)).toBe('dark');await fit('Library dark '+width+'px');await screenshot('library-mobile-'+width+'-dark');await page.getByRole('button',{name:'Change appearance',exact:true}).click();
 }
 check('Saved songs, library layouts and mini-player fit 390px and 320px phones in light and dark themes');
 }
 await verifySavedBytes();assert.deepEqual(report.unexpectedMutations,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.issues,[]);report.maxConcurrentRequests=maxInFlight;report.maxConcurrentPerSong=Object.fromEntries(maxPerSong);report.status='passed';
}catch(error){report.status='failed';report.failure=error instanceof Error?error.message:String(error);await page?.screenshot({path:'.local/download-browser-failure.png'}).catch(()=>{});throw error;}
finally{await fs.writeFile(progressiveOnly?'.local/progressive-integration-browser-report.json':'.local/download-browser-report.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks,maxConcurrentRequests:maxInFlight,pageErrors:report.pageErrors}));}
