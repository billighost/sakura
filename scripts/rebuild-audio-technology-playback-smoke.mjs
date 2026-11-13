/** Actual playback/DSP routing with fully intercepted synthetic APIs; no account writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
const expect=baseExpect.configure({timeout:20000});

const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3004';
const session=JSON.parse(await fs.readFile('.local/rebuild-test-account.json','utf8'));
const sampleRate=48000,frames=24*sampleRate,wav=Buffer.alloc(44+frames*4);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
for(let i=0;i<frames;i++){const value=Math.round(32767*(.12*Math.sin(2*Math.PI*1000*i/sampleRate)+.06*Math.sin(2*Math.PI*90*i/sampleRate)));wav.writeInt16LE(value,44+i*4);wav.writeInt16LE(value,46+i*4);}
const sha=createHash('sha256').update(wav).digest('hex');
const accounts={A:{id:'90000000-0000-4000-8000-000000000031',username:'Audio playback A',email:'audio-a@example.invalid'},B:{id:'90000000-0000-4000-8000-000000000032',username:'Audio playback B',email:'audio-b@example.invalid'}};
const tracks=[1,2].map(i=>{
 const id=`80000000-0000-4000-8000-${String(i).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 return {id,recordingId:id,title:`Audio integration song ${i}`,artists:['Synthetic audio fixture'],artistId:null,albumId:null,albumTitle:'Playback verification',durationMs:24000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(i)},references:[{provider:'deezer',id:String(i)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:24000,url:`https://res.cloudinary.com/audio-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const report={scope:'Synthetic profiles/settings/catalog; generated stereo PCM WAV intercepted at immutable-CDN and same-origin routes; no database mutations or physical-output qualification',cases:[],failures:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});

async function createCase(initialMode='none'){
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addCookies(session.cookie.split('; ').map(value=>{const split=value.indexOf('=');return{name:value.slice(0,split),value:value.slice(split+1),url:base};}));
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  const NativeAudio=window.Audio, connect=AudioNode.prototype.connect;
  window.__integration={audios:[],inputs:[],outputs:[],contexts:[],masters:[],routes:[]};
  window.Audio=function(...args){const value=new NativeAudio(...args),add=value.addEventListener,remove=value.removeEventListener;value.__integrationListeners=new Map();value.addEventListener=function(name,listener,...options){const group=value.__integrationListeners.get(name)||new Set();group.add(listener);value.__integrationListeners.set(name,group);return add.call(this,name,listener,...options);};value.removeEventListener=function(name,listener,...options){value.__integrationListeners.get(name)?.delete(listener);return remove.call(this,name,listener,...options);};window.__integration.audios.push(value);return value;};window.Audio.prototype=NativeAudio.prototype;
  const nativeContext=window.AudioContext;
  window.AudioContext=class extends nativeContext{constructor(...args){super(...args);window.__integration.contexts.push(this);}};
  function tap(node,kind){const analyser=node.context.createAnalyser(),quiet=node.context.createGain();analyser.fftSize=2048;quiet.gain.value=0;connect.call(node,analyser);connect.call(analyser,quiet);connect.call(quiet,node.context.destination);window.__integration[kind].push(analyser);}
  const createSource=nativeContext.prototype.createMediaElementSource;
  nativeContext.prototype.createMediaElementSource=function(...args){const value=createSource.apply(this,args);window.__integration.routes.push({element:args[0],context:this});tap(value,'inputs');return value;};
  AudioNode.prototype.connect=function(destination,...args){const value=connect.call(this,destination,...args);if(destination instanceof AudioDestinationNode){tap(this,'outputs');if(this instanceof GainNode)window.__integration.masters.push(this);}return value;};
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);
 let current='A';const modes={A:initialMode,B:'none'},patches=[],mediaRequests=[],errors=[],apiRequests=[],revisions={A:1,B:1},fieldRevisions={A:{},B:{}},saved={A:{},B:{}};
 const accountSettings=()=>({theme:'light',audioTechnology:modes[current],audioQuality:'high',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.8,...saved[current],revision:revisions[current],fieldRevisions:fieldRevisions[current]});
 page.on('pageerror',error=>errors.push(error.message));
 function serveAudio(route){mediaRequests.push({url:route.request().url(),resourceType:route.request().resourceType(),range:route.request().headers().range||null});const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
 await page.route('https://res.cloudinary.com/audio-fixture/**',serveAudio);
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;apiRequests.push({path,method:route.request().method(),account:current});
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return serveAudio(route);
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:accounts[current],stats:{},topArtists:[]}});
  if(path==='/api/v2/settings'){
   if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();patches.push({account:current,accountHeader:route.request().headers()['x-sakura-account'],body});if(body.audioTechnology)modes[current]=body.audioTechnology;const {expectedRevision,...changes}=body;assert.equal(expectedRevision,revisions[current]);Object.assign(saved[current],changes);revisions[current]++;for(const key of Object.keys(changes))fieldRevisions[current][key]=revisions[current];}
   return route.fulfill({json:accountSettings()});
  }
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}});
  if(path==='/api/v2/smart-queue')return route.fulfill({json:{tracks,reason:'Synthetic playback queue'}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:[]}});
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:[],schedule:{timeZone:'Africa/Lagos'}}});
  if(path.startsWith('/api/v2/recordings/')){const id=path.split('/').at(-1);return route.fulfill({json:{recording:tracks.find(t=>t.id===id)||tracks[0]}});}
  if(path==='/api/auth/session')return route.fulfill({json:{user:accounts[current]}});
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'not-found',lines:[]}});
  return route.fulfill({json:{}});
 });
 async function snapshot(){return page.evaluate(()=>{const state=window.__integration,a=state.audios.findLast(item=>item.src)||state.audios.at(-1),route=state.routes.findLast(item=>item.element===a&&item.context.state!=='closed');const rms=analyser=>{if(!analyser)return null;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length);};return {src:a?.src,currentSrc:a?.currentSrc,time:a?.currentTime,paused:a?.paused,volume:a?.volume,mediaError:a?.error?.code||null,contexts:state.contexts.length,contextStates:state.contexts.map(item=>item.state),routed:!!route,audios:state.audios.length,listeners:Object.fromEntries([...a.__integrationListeners].map(([name,listeners])=>[name,listeners.size])),retiredListeners:state.audios.filter(item=>item!==a).map(item=>[...item.__integrationListeners.values()].reduce((total,listeners)=>total+listeners.size,0)),inputRms:rms(route&&state.inputs.findLast(item=>item.context===route.context)),outputRms:rms(route&&state.outputs.findLast(item=>item.context===route.context)),masterGain:route?state.masters.findLast(item=>item.context===route.context)?.gain.value:null};});}
 async function navigateSettings(){await page.locator('a[href="/profile"]:visible').first().click();await expect(page).toHaveURL(base+'/profile');await expect(page.locator('[data-route-path="/profile"]')).toBeVisible();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.locator('[class*="routeLoading"]:visible')).toHaveCount(0);await page.getByRole('link',{name:'Shape your feed',exact:true}).click();await page.getByRole('heading',{name:'Audio technology',exact:true}).waitFor();}
 async function select(mode){const input=page.locator(`input[type="radio"][value="${mode}"]`);await input.check();await expect(input).toBeChecked();await expect.poll(()=>modes[current]).toBe(mode);}
 async function expectAudible(){await expect.poll(async()=>{const s=await snapshot();return s.time>.6&&!s.paused&&(!s.routed||s.outputRms>.0001);}).toBe(true);return snapshot();}
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
  const enhanced=await fixture.snapshot();await fixture.select('none');s=await fixture.expectAudible();assert.equal(s.src,enhanced.src,'Native reset retains the exact recording source');assert.equal(s.contexts,1);assert.equal(s.routed,false,'None uses a fresh native element');assert.equal(s.audios,enhanced.audios+1);await expect.poll(async()=>(await fixture.snapshot()).contextStates).toEqual(['closed']);assert.ok(s.time>=enhanced.time-.15&&s.time<enhanced.time+2,'native replacement retains passage position');assert.ok(s.retiredListeners.every(count=>count===0),'retired media has no player or engine listeners');assert.equal(s.listeners.loadedmetadata,1);assert.equal(s.listeners.playing,2);assert.equal(s.listeners.ratechange,1);const nativePosition=s.time;await expect.poll(async()=>(await fixture.snapshot()).time).toBeGreaterThan(nativePosition+.15);
  report.cases.push({name:'None after enhancement replaces media, closes graph and preserves passage without duplicate listeners',passed:true,before:enhanced,after:s});
  await fixture.select('punch');await fixture.select('headphones');await fixture.select('night');s=await fixture.expectAudible();assert.equal(s.contexts,2);assert.equal(s.routed,true);assert.equal(s.mediaError,null);
  report.cases.push({name:'Re-enabling sound creates one new graph and rapid switching remains audible',passed:true,snapshot:s});
  const volume=fixture.page.getByRole('slider',{name:'Player volume',exact:true});await volume.fill('.2');await expect.poll(async()=>(await fixture.snapshot()).masterGain).toBeCloseTo(.2,3);await fixture.page.waitForTimeout(200);s=await fixture.snapshot();assert.equal(s.volume,1);assert.ok(s.outputRms>0);await volume.fill('0');await fixture.page.waitForTimeout(220);const muted=await fixture.snapshot();assert.ok(muted.outputRms<.00001,'master mute produces silence');assert.ok(muted.inputRms>.0001,'mute leaves compressor source unaffected');await volume.fill('.8');await fixture.expectAudible();
  report.cases.push({name:'Volume and mute apply after processing',passed:true,quiet:s,muted});
  await fixture.select('none');await fixture.page.locator('a[href="/home"]').first().click();await fixture.page.getByRole('button',{name:'Find my soundtrack',exact:true}).click();await fixture.page.getByRole('button',{name:'Next song',exact:true}).first().click();await expect(fixture.page.getByRole('button',{name:'Open now playing',exact:true})).toContainText(tracks[1].title);s=await fixture.expectAudible();assert.ok(s.src===tracks[1].readyPlayback.url||s.src.startsWith('blob:'),'Native next song uses its immutable CDN source or completed local audio');assert.equal(s.contexts,2);assert.equal(s.routed,false);assert.equal(s.mediaError,null);assert.ok(s.retiredListeners.every(count=>count===0));
  report.cases.push({name:'Next None song stays native after prior enhancement',passed:true,snapshot:s});
  assert.deepEqual(fixture.errors,[]);assert.ok(fixture.patches.every(item=>item.accountHeader===accounts[item.account].id));assert.equal(fixture.apiRequests.filter(item=>item.path.includes('/resolve')).length,0,'ready pointers bypass resolver');
  report.accountPatches=fixture.patches;report.mediaRequests=fixture.mediaRequests;report.pageErrors=fixture.errors;
 }catch(error){report.diagnostic={url:fixture.page.url(),audio:await fixture.snapshot(),body:(await fixture.page.locator('body').innerText()).slice(0,5000),errors:fixture.errors,requests:fixture.apiRequests};throw error;}finally{await fixture.context.close();}
 const stored=await createCase('night');
 try{
  await stored.startTrack();let s=await stored.expectAudible();assert.equal(s.contexts,1);assert.ok(s.src.startsWith(base));assert.equal(stored.mediaRequests.filter(item=>item.resourceType==='media'&&item.url.startsWith('https://res.cloudinary.com')).length,0,'saved mode never attaches CORS-unsafe media');assert.ok(Math.abs(s.masterGain-.8)<.001);assert.deepEqual(stored.errors,[]);
  report.cases.push({name:'Stored Night mode initializes from first Play gesture',passed:true,snapshot:s});
  await stored.navigateSettings();await stored.select('warmth');stored.setAccount('B');await stored.page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>stored.apiRequests.filter(item=>(item.path==='/api/v2/bootstrap'||item.path==='/api/v2/profile')&&item.account==='B').length).toBeGreaterThan(0);await expect(stored.page.locator('input[type="radio"][value="none"]')).toBeChecked();s=await stored.snapshot();assert.ok(s.paused);assert.equal(stored.patches.filter(item=>item.account==='B').length,0,'A settings never PATCH into B');assert.ok(stored.patches.every(item=>item.accountHeader===accounts[item.account].id));assert.deepEqual(stored.errors,[]);
  report.cases.push({name:'Account switch pauses and restores B bypass without A patches',passed:true,snapshot:s});
 }finally{await stored.context.close();}
}catch(error){report.failures.push({message:error.message,stack:error.stack});process.exitCode=1;}
finally{await browser.close();await fs.mkdir('.local/audio-technology',{recursive:true});await fs.writeFile('.local/audio-technology/playback-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.cases.length,failures:report.failures.map(item=>item.message),report:'.local/audio-technology/playback-report.json'}));}
