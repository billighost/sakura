/** Actual production song/settings/player pages, real media/Web Audio, intercepted account APIs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3014';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local authentication signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000097',username:'Production volume fixture',email:'volume-production@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const rate=24000,samples=rate*90,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*2800),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['Production volume first song','Production volume second song'].map((title,i)=>{
 const id=`80000000-0000-4000-8000-${String(i+97).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i+97).padStart(12,'0')}`;
 return {id,recordingId:id,title,artists:['Synthetic volume artist'],durationMs:90000,albumTitle:'Production audio verification',coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(i+97)},references:[{provider:'deezer',id:String(i+97)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:90000,url:`https://res.cloudinary.com/production-volume-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.37,shuffle:false,repeat:'off'};
let settingsRevision=0;
const settingsFieldRevisions=Object.fromEntries(Object.keys(settings).map(key=>[key,0]));
const report={scope:'Production pages with synthetic account APIs and real generated tone; no temporary routes or database writes',limitation:'Chromium with iPhone UA, native touch and simulated fixed HTMLMediaElement.volume; physical iOS Safari is not certified',checks:[],measurements:[],mediaRequests:[],apiTimeline:[],unexpectedMutations:[],pageErrors:[]};
let browser,page,session=null,listeningDelayMs=0;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get:()=>1,set:()=>{}});
  const NativeContext=window.AudioContext,connect=AudioNode.prototype.connect;
  window.productionVolumeGraph={contexts:[],sources:[],masters:[],timeline:[]};
  const removeAttribute=Element.prototype.removeAttribute,play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
  Element.prototype.removeAttribute=function(name){if(this instanceof HTMLMediaElement&&name==='src')window.productionVolumeGraph.timeline.push({at:Date.now(),action:'remove-src',src:this.src});return removeAttribute.call(this,name);};
  HTMLMediaElement.prototype.play=function(...args){window.productionVolumeGraph.timeline.push({at:Date.now(),action:'play',src:this.src});return play.apply(this,args);};
  HTMLMediaElement.prototype.pause=function(...args){window.productionVolumeGraph.timeline.push({at:Date.now(),action:'pause',src:this.src});return pause.apply(this,args);};
  window.AudioContext=class extends NativeContext{constructor(...args){super(...args);window.productionVolumeGraph.contexts.push(this);}};
  const createSource=NativeContext.prototype.createMediaElementSource;
  NativeContext.prototype.createMediaElementSource=function(media){const source=createSource.call(this,media),meter=this.createAnalyser(),silent=this.createGain();meter.fftSize=2048;silent.gain.value=0;connect.call(source,meter);connect.call(meter,silent);connect.call(silent,this.destination);window.productionVolumeGraph.sources.push({media,context:this,meter});return source;};
  AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination&&this instanceof GainNode){const meter=this.context.createAnalyser();meter.fftSize=2048;connect.call(this,meter);window.productionVolumeGraph.masters.push({gain:this,meter,context:this.context});}return result;};
 });
 function audio(route){report.mediaRequests.push(route.request().url());const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
 await context.route('https://res.cloudinary.com/production-volume-fixture/**',audio);
 await context.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(['/api/v2/profile','/api/v2/settings','/api/v2/listening-session','/api/v2/recordings/resolve'].includes(path))report.apiTimeline.push({at:Date.now(),path,method:request.method(),requestRevision:request.method()==='PUT'?request.postDataJSON().revision:undefined,remoteRevision:session?.revision});
  if(request.headers()['x-sakura-account']&&request.headers()['x-sakura-account']!==account.id)return route.fulfill({status:401,json:{error:'Account changed'}});
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return audio(route);
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings'){
   if(request.method()==='PATCH'){
    const {expectedRevision,...patch}=request.postDataJSON();
    if(expectedRevision!==undefined&&expectedRevision!==settingsRevision)return route.fulfill({status:409,json:{error:'Your settings changed on another device.'}});
    Object.assign(settings,patch);settingsRevision++;
    for(const key of Object.keys(patch))settingsFieldRevisions[key]=settingsRevision;
   }
   return route.fulfill({json:{...settings,revision:settingsRevision,fieldRevisions:settingsFieldRevisions}});
  }
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/feed'||path==='/api/v2/feed/hero'){
   const items=tracks.map(track=>({track,lane:'similar',reason:'Production audio fixture'}));
   return route.fulfill({json:path.endsWith('/hero')?{item:items[0],refreshAt:Date.now()+600000}:{items,sections:[],nextCursor:null,personalized:true,totalCandidates:items.length,generatedAt:new Date().toISOString()}});
  }
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){const data=request.postDataJSON();if((session?.revision||0)!==data.revision)return route.fulfill({json:{accepted:false,session,serverTime:Date.now()}});session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   if(listeningDelayMs)await new Promise(resolve=>setTimeout(resolve,listeningDelayMs));report.apiTimeline.push({at:Date.now(),path,method:'GET response',remoteRevision:session?.revision});return route.fulfill({json:{session,serverTime:Date.now()}});
  }
  if(path==='/api/v2/recordings/resolve'){const track=tracks.find(t=>t.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'not-found',lines:[]}});
  if(path==='/api/v2/smart-queue')return route.fulfill({json:{tracks:[]}});
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(t=>t.id===path.split('/').at(-1))||tracks[0]}});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(!['GET','HEAD'].includes(request.method())){report.unexpectedMutations.push({path,method:request.method()});return route.fulfill({status:503,json:{error:'Unexpected fixture mutation'}});}
  return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
 });
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 async function snapshot(){return page.evaluate(accountId=>{
  const graph=window.productionVolumeGraph,rms=meter=>{const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);};
  const cached=JSON.parse(localStorage.getItem('sakura-v2-preferences:'+accountId)||'null');
  return {path:location.pathname,cachedVolume:cached?.settings?.volume,contexts:graph.contexts.map(c=>c.state),timeline:graph.timeline,audio:graph.sources.map(source=>{const master=graph.masters.find(m=>m.context===source.context);return {src:source.media.src,time:source.media.currentTime,paused:source.media.paused,elementVolume:source.media.volume,context:source.context.state,gain:master?.gain.gain.value,input:rms(source.meter),output:master?rms(master.meter):0};})};
 },account.id);}
 async function audible(){await expect.poll(async()=>{const a=(await snapshot()).audio[0];return a&&a.context==='running'&&!a.paused&&a.time>.15&&a.output>.0001;}).toBeTruthy();return(await snapshot()).audio[0];}
 async function measure(name,a,volume){await expect.poll(async()=>{a=(await snapshot()).audio[0];return a?.context==='running'&&Math.abs(a.gain-volume)<.001&&Math.abs(a.output/a.input-volume)<.02;}, {message:`${name} reaches the saved audible level`}).toBe(true);assert.equal(a.elementVolume,1);report.measurements.push({name,volume,inputRms:a.input,outputRms:a.output,ratio:a.output/a.input,src:a.src});}
 async function touchVolume(slider,fraction){await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();assert.ok(box);await page.touchscreen.tap(box.x+box.width*fraction,box.y+box.height/2);return Number(await slider.inputValue());}
 async function closePlayer(){
  const sheet=page.locator('dialog[open][data-dialog-appearance="player"]');
  const handle=sheet.locator('[data-dialog-swipe-handle]');
  await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();assert.ok(box);
  const touch=await context.newCDPSession(page),x=box.x+box.width*.5,y=box.y+box.height*.12;
  try{
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
   for(let step=1;step<=8;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+step*20,id:1}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await touch.detach();}
  await expect(sheet).toHaveCount(0);
 }

 await page.goto(base+'/track/'+tracks[0].id,{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('heading',{name:tracks[0].title,exact:true}).waitFor();assert.equal((await snapshot()).contexts.length,0);
 await page.getByRole('button',{name:'Play song',exact:true}).tap();let a=await audible();assert.ok(a.src.startsWith(base+tracks[0].readyPlayback.fallbackUrl));await measure('First Play with saved None volume',a,.37);report.checks.push('Production /track first tap starts real same-origin audio with saved .37 gain despite fixed element volume');
 await page.getByRole('button',{name:'Open now playing',exact:true}).tap();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 const playerVolume=dialog.getByRole('slider',{name:'Volume',exact:true});const quiet=await touchVolume(playerVolume,.22);assert.ok(quiet>.1&&quiet<.3);await expect.poll(()=>settings.volume).toBe(quiet);a=await audible();await measure('Fullscreen native touch volume',a,quiet);report.checks.push('Actual fullscreen botanical volume responds to native touch and saves the audible level');
 await dialog.getByRole('button',{name:'Mute audio',exact:true}).tap();await expect.poll(async()=>(await snapshot()).audio[0].output).toBeLessThan(.00001);assert.ok((await snapshot()).audio[0].input>.001);await dialog.getByRole('button',{name:'Unmute audio',exact:true}).tap();a=await audible();await measure('Unmute restores preceding level',a,quiet);report.checks.push('Mute silences output while media continues; unmute restores the preceding audible level');
 await dialog.getByRole('button',{name:'Pause',exact:true}).tap();await expect.poll(async()=>(await snapshot()).audio[0].paused).toBe(true);await page.evaluate(()=>window.productionVolumeGraph.contexts[0].suspend());await dialog.getByRole('button',{name:'Play',exact:true}).tap();a=await audible();assert.equal(a.context,'running');await measure('Resume after context suspension',a,quiet);report.checks.push('Actual player resumes paused audio and its suspended Web Audio context');
 await closePlayer();await page.locator('header a[href="/profile"]:visible').first().click();await expect(page).toHaveURL(base+'/profile');await page.locator('a[href^="/settings"]:visible').first().click();await page.getByRole('heading',{name:'Just the way you like it.',exact:true}).waitFor();
 const saved=await touchVolume(page.getByRole('slider',{name:'Player volume',exact:true}),.61);assert.ok(saved>.5&&saved<.7);await expect.poll(()=>settings.volume).toBe(saved);a=await audible();await measure('Settings native Player volume',a,saved);assert.equal((await snapshot()).audio.length,1);report.checks.push('Native touch on production Settings Player volume changes real gain without rebuilding the media source');
 await page.getByRole('link',{name:'Home',exact:true}).last().tap();await page.getByRole('link',{name:tracks[1].title,exact:true}).first().tap();await page.getByRole('heading',{name:tracks[1].title,exact:true}).waitFor();await page.getByRole('button',{name:'Play song',exact:true}).tap();a=await audible();assert.ok(a.src.startsWith(base+tracks[1].readyPlayback.fallbackUrl));assert.equal((await snapshot()).audio.length,1);await measure('Second /track song with saved level',a,saved);report.checks.push('Playing a second production /track song keeps one media source, compatible routing and saved volume');
 const restored=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/listening-session'&&response.request().method()==='GET');await page.reload({waitUntil:'domcontentloaded'});await restored;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.getByRole('heading',{name:tracks[1].title,exact:true}).waitFor();await expect.poll(()=>page.evaluate(accountId=>JSON.parse(localStorage.getItem('sakura-v2-listening:'+accountId)||'null')?.pending,account.id)).toBe(false);assert.equal((await snapshot()).contexts.length,0);assert.equal((await snapshot()).cachedVolume,saved);await page.getByRole('button',{name:'Play song',exact:true}).tap();a=await audible();await measure('Reload first audible note at saved level',a,saved);report.checks.push('Reload restores local/account volume before the first audible note and does not autoplay after session bootstrap settles');
 await page.getByRole('button',{name:'Open now playing',exact:true}).tap();dialog=page.getByRole('dialog');await expect(dialog.getByRole('slider',{name:'Volume',exact:true})).toHaveValue(String(saved));
 await closePlayer();listeningDelayMs=1200;report.quickPlayStartedAt=Date.now();const delayedResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/listening-session'&&response.request().method()==='GET');await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:tracks[1].title,exact:true}).waitFor();report.quickPlayTappedAt=Date.now();await page.getByRole('button',{name:'Play song',exact:true}).tap();await audible();await delayedResponse;report.quickPlayResponseAt=Date.now();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));a=await audible();await measure('Quick Play survives delayed session response',a,saved);assert.ok(report.quickPlayTappedAt<report.quickPlayResponseAt);report.quickPlaySnapshot=await snapshot();report.checks.push('Quick Play as the cached song page paints stays audible after a deliberately delayed session response');
 await page.getByRole('button',{name:'Open now playing',exact:true}).tap();
 assert.ok(report.mediaRequests.length>0);assert.ok(report.mediaRequests.every(url=>url.startsWith(base+'/api/v2/recordings/')||tracks.some(track=>url===track.readyPlayback.url)),'All active audio and speculative prewarming use intercepted fixture sources');assert.deepEqual(report.unexpectedMutations,[]);assert.deepEqual(report.pageErrors,[]);
 await fs.mkdir('.local',{recursive:true});await page.screenshot({path:'.local/production-iphone-volume.png'});
}catch(error){report.error=String(error);report.failureSnapshot=await page?.evaluate(()=>({path:location.pathname,contexts:window.productionVolumeGraph?.contexts.map(c=>c.state),sources:window.productionVolumeGraph?.sources.map(s=>({src:s.media.src,time:s.media.currentTime,paused:s.media.paused,error:s.media.error?.message})),masters:window.productionVolumeGraph?.masters.map(m=>m.gain.gain.value)})).catch(()=>null);process.exitCode=1;}
finally{await browser?.close();await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/production-iphone-volume-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,error:report.error||null,pageErrors:report.pageErrors,report:'.local/production-iphone-volume-report.json'}));}
