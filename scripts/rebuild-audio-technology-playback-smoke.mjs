/** Actual playback/DSP routing with fully intercepted synthetic APIs; no account writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
const expect=baseExpect.configure({timeout:20000});

const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3004';
const session=JSON.parse(await fs.readFile('.local/rebuild-test-account.json','utf8'));
const wav=await fs.readFile('.local/audio-technology/source.wav');
const sha=createHash('sha256').update(wav).digest('hex');
const accounts={A:{id:'90000000-0000-4000-8000-000000000031',username:'Audio playback A',email:'audio-a@example.invalid'},B:{id:'90000000-0000-4000-8000-000000000032',username:'Audio playback B',email:'audio-b@example.invalid'}};
const tracks=[1,2].map(i=>{
 const id=`80000000-0000-4000-8000-${String(i).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 return {id,recordingId:id,title:`Audio integration song ${i}`,artists:['Synthetic audio fixture'],artistId:null,albumId:null,albumTitle:'Playback verification',durationMs:24000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(i)},references:[{provider:'deezer',id:String(i)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:24000,url:`https://res.cloudinary.com/audio-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const report={scope:'Synthetic profiles/settings/catalog; local WAV audio intercepted at immutable-CDN and same-origin routes; no database mutations',cases:[],failures:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});

async function createCase(initialMode='none'){
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addCookies(session.cookie.split('; ').map(value=>{const split=value.indexOf('=');return{name:value.slice(0,split),value:value.slice(split+1),url:base};}));
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  const NativeAudio=window.Audio, connect=AudioNode.prototype.connect;
  window.__integration={audios:[],inputs:[],outputs:[],contexts:[],masters:[]};
  window.Audio=function(...args){const value=new NativeAudio(...args);window.__integration.audios.push(value);return value;};window.Audio.prototype=NativeAudio.prototype;
  const nativeContext=window.AudioContext;
  window.AudioContext=class extends nativeContext{constructor(...args){super(...args);window.__integration.contexts.push(this);}};
  function tap(node,kind){const analyser=node.context.createAnalyser(),quiet=node.context.createGain();analyser.fftSize=2048;quiet.gain.value=0;connect.call(node,analyser);connect.call(analyser,quiet);connect.call(quiet,node.context.destination);window.__integration[kind].push(analyser);}
  const createSource=nativeContext.prototype.createMediaElementSource;
  nativeContext.prototype.createMediaElementSource=function(...args){const value=createSource.apply(this,args);tap(value,'inputs');return value;};
  AudioNode.prototype.connect=function(destination,...args){const value=connect.call(this,destination,...args);if(destination instanceof AudioDestinationNode){tap(this,'outputs');if(this instanceof GainNode)window.__integration.masters.push(this);}return value;};
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);
 let current='A';const modes={A:initialMode,B:'none'},patches=[],mediaRequests=[],errors=[],apiRequests=[];
 page.on('pageerror',error=>errors.push(error.message));
 function serveAudio(route){mediaRequests.push({url:route.request().url(),range:route.request().headers().range||null});const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
 await page.route('https://res.cloudinary.com/audio-fixture/**',serveAudio);
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;apiRequests.push({path,method:route.request().method(),account:current});
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return serveAudio(route);
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:accounts[current],stats:{},topArtists:[]}});
  if(path==='/api/v2/settings'){
   if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();patches.push({account:current,accountHeader:route.request().headers()['x-sakura-account'],body});if(body.audioTechnology)modes[current]=body.audioTechnology;}
   return route.fulfill({json:{theme:'light',audioTechnology:modes[current],audioQuality:'high',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4}});
  }
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:[],schedule:{timeZone:'Africa/Lagos'}}});
  if(path.startsWith('/api/v2/recordings/')){const id=path.split('/').at(-1);return route.fulfill({json:{recording:tracks.find(t=>t.id===id)||tracks[0]}});}
  if(path==='/api/auth/session')return route.fulfill({json:{user:accounts[current]}});
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'not-found',lines:[]}});
  return route.fulfill({json:{}});
 });
 async function snapshot(){return page.evaluate(()=>{const state=window.__integration,a=state.audios.findLast(item=>item.src)||state.audios.at(-1);const rms=analyser=>{if(!analyser)return null;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);};return {src:a?.src,currentSrc:a?.currentSrc,time:a?.currentTime,paused:a?.paused,volume:a?.volume,mediaError:a?.error?.code||null,contexts:state.contexts.length,contextStates:state.contexts.map(item=>item.state),inputRms:rms(state.inputs.at(-1)),outputRms:rms(state.outputs.at(-1)),masterGain:state.masters.at(-1)?.gain.value};});}
 async function navigateSettings(){await page.locator('a[href="/profile"]').first().click();await page.locator('a[href="/settings"]').first().click();await page.getByRole('heading',{name:'Audio technology',exact:true}).waitFor();}
 async function select(mode){const input=page.locator(`input[type="radio"][value="${mode}"]`);await input.check();await expect(input).toBeChecked();await expect.poll(()=>modes[current]).toBe(mode);}
 async function expectAudible(){await expect.poll(async()=>{const s=await snapshot();return s.time>.6&&!s.paused&&s.outputRms>.0001;}).toBe(true);return snapshot();}
 async function startTrack(index=0){await page.goto(base+'/track/'+tracks[index].id,{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('heading',{name:tracks[index].title,exact:true}).waitFor();await page.getByRole('button',{name:'Play song',exact:true}).click();await expect.poll(async()=>(await snapshot()).time).toBeGreaterThan(.8);}
 return {context,page,modes,patches,mediaRequests,errors,apiRequests,snapshot,navigateSettings,select,expectAudible,startTrack,setAccount:value=>{current=value;}};
}

try{
 const fixture=await createCase();
 try{
  await fixture.startTrack();let s=await fixture.snapshot();assert.equal(s.contexts,0,'None starts without AudioContext');assert.equal(s.src,tracks[0].readyPlayback.url);assert.equal(s.volume,.8);assert.equal(s.mediaError,null);
  report.cases.push({name:'Default None starts native CDN',passed:true,snapshot:s});
  await fixture.navigateSettings();await fixture.page.evaluate(()=>{const a=window.__integration.audios.findLast(item=>item.src);a.currentTime=5;});await expect.poll(async()=>(await fixture.snapshot()).time).toBeGreaterThan(5.1);
  const before=await fixture.snapshot();await fixture.select('clarity');s=await fixture.expectAudible();assert.ok(s.src.startsWith(base+tracks[0].readyPlayback.fallbackUrl),'Clarity uses the same-asset gateway');assert.equal(s.contexts,1);assert.ok(s.time>=before.time-.12&&s.time<before.time+2,'migration preserves passage position');assert.equal(s.volume,1,'element volume normalized for processing');assert.ok(Math.abs(s.masterGain-.8)<.001);
  report.cases.push({name:'Clarity migrates same asset and preserves position',passed:true,before,after:s});
  await fixture.select('warmth');s=await fixture.expectAudible();assert.equal(s.contexts,1);assert.ok(s.src.includes('/audio?assetId='));
  await fixture.select('none');s=await fixture.expectAudible();assert.ok(s.src.startsWith(base),'None after initialization stays CORS-safe');assert.equal(s.contexts,1);
  await fixture.select('punch');await fixture.select('headphones');await fixture.select('night');s=await fixture.expectAudible();assert.equal(s.contexts,1);assert.equal(s.mediaError,null);
  report.cases.push({name:'Warmth, bypass and rapid mode switching remain audible',passed:true,snapshot:s});
  const volume=fixture.page.getByRole('slider',{name:'Player volume',exact:true});await volume.fill('.2');await expect.poll(async()=>(await fixture.snapshot()).masterGain).toBeCloseTo(.2,3);await fixture.page.waitForTimeout(200);s=await fixture.snapshot();assert.equal(s.volume,1);assert.ok(s.outputRms>0);await volume.fill('0');await fixture.page.waitForTimeout(220);const muted=await fixture.snapshot();assert.ok(muted.outputRms<.00001,'master mute produces silence');assert.ok(muted.inputRms>.0001,'mute leaves compressor source unaffected');await volume.fill('.8');await fixture.expectAudible();
  report.cases.push({name:'Volume and mute apply after processing',passed:true,quiet:s,muted});
  await fixture.select('none');await fixture.page.locator('a[href="/home"]').first().click();await fixture.page.getByRole('button',{name:'Find my soundtrack',exact:true}).click();await fixture.page.getByRole('button',{name:'Next song',exact:true}).first().click();await expect.poll(async()=>(await fixture.snapshot()).src).toContain(tracks[1].readyPlayback.fallbackUrl);s=await fixture.expectAudible();assert.equal(s.contexts,1);assert.equal(s.mediaError,null);
  report.cases.push({name:'Next song remains safe after engine initialization',passed:true,snapshot:s});
  await fixture.navigateSettings();await fixture.select('warmth');fixture.setAccount('B');await fixture.page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>fixture.apiRequests.filter(item=>(item.path==='/api/v2/bootstrap'||item.path==='/api/v2/profile')&&item.account==='B').length).toBeGreaterThan(0);await expect(fixture.page.locator('input[type="radio"][value="none"]')).toBeChecked();s=await fixture.snapshot();assert.ok(s.paused);assert.equal(fixture.patches.filter(item=>item.account==='B').length,0,'A settings never PATCH into B');
  report.cases.push({name:'Account switch pauses and restores B bypass without A patches',passed:true,snapshot:s});
  assert.deepEqual(fixture.errors,[]);assert.ok(fixture.patches.every(item=>item.accountHeader===accounts[item.account].id));assert.equal(fixture.apiRequests.filter(item=>item.path.includes('/resolve')).length,0,'ready pointers bypass resolver');
  report.accountPatches=fixture.patches;report.mediaRequests=fixture.mediaRequests;report.pageErrors=fixture.errors;
 }catch(error){report.diagnostic={url:fixture.page.url(),audio:await fixture.snapshot(),body:(await fixture.page.locator('body').innerText()).slice(0,5000),errors:fixture.errors,requests:fixture.apiRequests};throw error;}finally{await fixture.context.close();}
 const stored=await createCase('night');
 try{
  await stored.startTrack();const s=await stored.expectAudible();assert.equal(s.contexts,1);assert.ok(s.src.startsWith(base));assert.equal(stored.mediaRequests.filter(item=>item.url.startsWith('https://res.cloudinary.com')).length,0,'saved mode never loads CORS-unsafe media');assert.ok(Math.abs(s.masterGain-.8)<.001);assert.deepEqual(stored.errors,[]);
  report.cases.push({name:'Stored Night mode initializes from first Play gesture',passed:true,snapshot:s});
 }finally{await stored.context.close();}
}catch(error){report.failures.push({message:error.message,stack:error.stack});process.exitCode=1;}
finally{await browser.close();await fs.mkdir('.local/audio-technology',{recursive:true});await fs.writeFile('.local/audio-technology/playback-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.cases.length,failures:report.failures.map(item=>item.message),report:'.local/audio-technology/playback-report.json'}));}
