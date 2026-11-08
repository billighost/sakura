/** Real MusicContext/Bloom soundtrack and touch controls; intercepted APIs, no DB writes. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium,webkit,expect as baseExpect} from '@playwright/test';
import 'dotenv/config';
import {encode} from 'next-auth/jwt';
const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const engine=process.env.SAKURA_MOBILE_BROWSER||'chromium';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Auth signing configuration is required for the isolated browser fixture');
const account={id:'90000000-0000-4000-8000-000000000092',username:'Volume fixture',email:'volume@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const rate=24000,samples=rate*45,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*2800),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['Volume first song','Volume second song'].map((title,i)=>{
 const id=`80000000-0000-4000-8000-${String(i+92).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i+92).padStart(12,'0')}`;
 return {id,recordingId:id,title,artists:['Synthetic artist'],durationMs:45000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(i+92)},references:[{provider:'deezer',id:String(i+92)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:45000,url:`https://res.cloudinary.com/volume-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.37,shuffle:false,repeat:'off'};
const routeDir='src/app/(music)/volume-check',routePath=routeDir+'/page.tsx';
assert.equal(await fs.stat(routePath).then(()=>true,()=>false),false,'Do not overwrite an existing verification page');
await fs.mkdir(routeDir,{recursive:true});await fs.copyFile('scripts/fixtures/mobile-volume-room.tsx',routePath);
const checks=[],errors=[],requests=[],patches=[];let session=null,browser,page;
try{
 browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',serviceWorkers:'block'});
 if(engine==='webkit'){
  const probe=await context.newPage();await probe.goto(base+'/login',{waitUntil:'domcontentloaded'});
  const supportsAudio=await probe.evaluate(()=>typeof AudioContext==='function'&&typeof AudioNode==='function');await probe.close();
  assert.ok(supportsAudio,'This WebKit build omits Web Audio (including Windows Playwright WebKit). Run this audible-output test in Chromium; WebKit still verifies input focus and cover scrolling.');
 }
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  // Match the iPhone getter/setter restriction while using real media and Web Audio.
  Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get:()=>1,set:()=>{}});
  const nativeContext=window.AudioContext,connect=AudioNode.prototype.connect;
  window.volumeGraph={contexts:[],sources:[],masters:[]};
  window.AudioContext=class extends nativeContext{constructor(...args){super(...args);window.volumeGraph.contexts.push(this);}};
  const createSource=nativeContext.prototype.createMediaElementSource;
  nativeContext.prototype.createMediaElementSource=function(media){const source=createSource.call(this,media),meter=this.createAnalyser(),silent=this.createGain();meter.fftSize=2048;silent.gain.value=0;connect.call(source,meter);connect.call(meter,silent);connect.call(silent,this.destination);window.volumeGraph.sources.push({media,context:this,meter});return source;};
  AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination&&this instanceof GainNode){const meter=this.context.createAnalyser();meter.fftSize=2048;connect.call(this,meter);window.volumeGraph.masters.push({gain:this,meter,context:this.context});}return result;};
 });
 function audio(route){requests.push(route.request().url());const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
 await context.route('https://res.cloudinary.com/volume-fixture/**',audio);
 await context.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return audio(route);
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account}});
  if(path==='/api/v2/settings'){if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();patches.push(body);Object.assign(settings,body);}return route.fulfill({json:settings});}
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/listening-session'){if(route.request().method()==='PUT'){const data=route.request().postDataJSON();if((session?.revision||0)!==data.revision)return route.fulfill({json:{accepted:false,session,serverTime:Date.now()}});session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}return route.fulfill({json:{session,serverTime:Date.now()}});}
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'not-found',lines:[]}});
  if(path.startsWith('/api/v2/recordings/'))return route.fulfill({json:{recording:tracks.find(t=>t.id===path.split('/').at(-1))||tracks[0]}});
  return route.fulfill({json:{items:[],recordings:[]}});
 });
 page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
 async function snapshot(){return page.evaluate(()=>{
  const graph=window.volumeGraph,p=window.volumeState;
  const rms=meter=>{const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);};
  return {status:p?.status,volume:p?.volume,track:p?.track?.title,contexts:graph.contexts.map(c=>c.state),audio:graph.sources.map(source=>{const master=graph.masters.find(m=>m.context===source.context);return {src:source.media.src,time:source.media.currentTime,paused:source.media.paused,elementVolume:source.media.volume,context:source.context.state,gain:master?.gain.gain.value,input:rms(source.meter),output:master?rms(master.meter):0};})};
 });}
 async function audible(index=0){await expect.poll(async()=>{const a=(await snapshot()).audio[index];return a&&!a.paused&&a.time>.5&&a.output>.0001;}).toBeTruthy();return(await snapshot()).audio[index];}
 async function visit(){await page.goto(base+'/volume-check',{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('button',{name:'Play first song',exact:true}).waitFor();await expect.poll(async()=>(await snapshot()).volume).toBe(settings.volume);}
 await visit();assert.equal((await snapshot()).contexts.length,0);await page.getByRole('button',{name:'Play first song',exact:true}).tap();let a=await audible();
 assert.ok(a.src.startsWith(base+tracks[0].readyPlayback.fallbackUrl));assert.equal(a.elementVolume,1);assert.ok(Math.abs(a.gain-.37)<.001);assert.ok(Math.abs(a.output/a.input-.37)<.02);checks.push('iPhone None uses compatible audio and saved gain .37 with fixed element volume');
 const volume=page.getByRole('slider',{name:'Verification volume',exact:true}),box=await volume.boundingBox();assert.ok(box);
 await page.touchscreen.tap(box.x+box.width*.22,box.y+box.height/2);await expect.poll(async()=>(await snapshot()).volume).toBeLessThan(.3);await expect.poll(()=>settings.volume).toBeLessThan(.3);a=await audible();assert.ok(Math.abs(a.gain-settings.volume)<.001);checks.push('Native touch volume tap changes audible gain and saved settings');
 await volume.fill('0');await expect.poll(async()=>(await snapshot()).audio[0].output).toBeLessThan(.00001);assert.ok((await snapshot()).audio[0].input>.001);await page.getByRole('button',{name:'Unmute audio',exact:true}).first().tap();await audible();checks.push('Mute produces silence and unmute restores audible output');
 await page.getByRole('button',{name:'Pause or resume',exact:true}).tap();await expect.poll(async()=>(await snapshot()).audio[0].paused).toBe(true);await page.evaluate(()=>window.volumeGraph.contexts[0].suspend());await page.getByRole('button',{name:'Pause or resume',exact:true}).tap();await audible();checks.push('Resuming paused/interrupted iPhone playback resumes the gain context');
 await page.getByRole('button',{name:'Use night sound',exact:true}).tap();await expect.poll(()=>settings.audioTechnology).toBe('night');await audible();await page.getByRole('button',{name:'Use original sound',exact:true}).tap();await expect.poll(()=>settings.audioTechnology).toBe('none');await audible();assert.equal((await snapshot()).audio.length,1);checks.push('Changing sound modes and returning to None reuses one source and stays audible');
 await page.getByRole('button',{name:'Play second song',exact:true}).tap();await expect.poll(async()=>(await snapshot()).track).toBe(tracks[1].title);a=await audible();assert.ok(a.src.startsWith(base+tracks[1].readyPlayback.fallbackUrl));checks.push('Switching tracks keeps compatible routing and audible saved volume');
 await page.getByRole('button',{name:'Play chapter soundtrack',exact:true}).tap();a=await audible(1);assert.equal((await snapshot()).audio[0].paused,true);assert.ok(a.src.startsWith(base+tracks[1].readyPlayback.fallbackUrl));assert.ok(Math.abs(a.gain-settings.volume)<.001);checks.push('Bloom chapter soundtrack uses iPhone master gain and pauses main song');
 await volume.fill('.15');await expect.poll(async()=>(await snapshot()).audio[1].gain).toBeCloseTo(.15,3);await page.waitForTimeout(180);a=(await snapshot()).audio[1];assert.ok(Math.abs(a.output/a.input-.15)<.02);await page.getByRole('button',{name:'Pause chapter',exact:true}).tap();await expect.poll(async()=>(await snapshot()).audio[1].paused).toBe(true);await page.getByRole('button',{name:'Resume chapter',exact:true}).tap();await audible(1);checks.push('Bloom volume follows the slider and pause/resume stays audible');
 await page.getByRole('button',{name:'Close chapter',exact:true}).tap();await audible();assert.equal((await snapshot()).audio[1].paused,true);checks.push('Closing the chapter restores the original song and queue');
 await expect.poll(()=>settings.volume).toBe(.15);await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Play first song',exact:true}).waitFor();await expect.poll(async()=>(await snapshot()).volume).toBe(.15);await page.getByRole('button',{name:'Play first song',exact:true}).tap();a=await audible();assert.ok(Math.abs(a.gain-.15)<.001);checks.push('Reload restores saved .15 volume before the first audible note');
 assert.ok(requests.every(url=>url.startsWith(base+'/api/v2/recordings/')));assert.ok(patches.some(p=>p.volume===.15));assert.deepEqual(errors,[]);
 await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/iphone-volume-'+engine+'-report.json',JSON.stringify({engine,checks,pageErrors:errors,requests,limitation:'Real Web Audio and media with simulated iPhone fixed element volume; desktop WebKit is not a physical iPhone.'},null,2));console.log(JSON.stringify({engine,checks,pageErrors:errors}));
}catch(error){const state=await page?.evaluate(()=>({status:window.volumeState?.status,volume:window.volumeState?.volume,error:window.volumeState?.error,contexts:window.volumeGraph?.contexts.map(c=>c.state),sources:window.volumeGraph?.sources.map(s=>({src:s.media.src,time:s.media.currentTime,paused:s.media.paused,error:s.media.error?.message,context:s.context.state})),masters:window.volumeGraph?.masters.map(m=>m.gain.gain.value)})).catch(()=>null);await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/iphone-volume-'+engine+'-failure.json',JSON.stringify({engine,checks,pageErrors:errors,requests,state,error:String(error)},null,2));throw error;}
finally{await browser?.close();await fs.rm(routePath,{force:true});await fs.rmdir(routeDir).catch(()=>{});}
