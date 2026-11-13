/** Shipped Settings preview with generated audio and strict synthetic APIs.
 * Native worker/context instrumentation observes the production bundle; no
 * source module injection, provider audio, database fixture or app route. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium, expect as baseExpect} from '@playwright/test';
import {installPerformanceFixture, localOrigin, performanceCatalog} from './fixtures/performance-browser.mjs';

const base=localOrigin(process.env.SAKURA_TEST_URL||'http://127.0.0.1:3117');
const expect=baseExpect.configure({timeout:25000});
const account={id:'94030000-0000-4000-8000-000000000601',username:'Audio preview fixture',email:'audio-preview@example.invalid'};
const catalog=performanceCatalog({count:1,offset:9601,label:'Production audio preview'});
const currentSongTitle=catalog.tracks[0].artists.join(', ')+' — '+catalog.tracks[0].title;
const fileBytes=Buffer.from(catalog.wav);
for(let i=0;i<(fileBytes.length-44)/2;i++)fileBytes.writeInt16LE(Math.round(Math.sin(i/8000*440*Math.PI*2)*1100),44+i*2);
const output='.local/audio-preview-production-browser';
const report={checkedAt:new Date().toISOString(),buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),scope:'Current production Settings UI, generated WAV, synthetic signed session and intercepted APIs. Native worker replies/context clocks are real; held reply cancellation is synthetic. No physical output or deployed performance claim.',checks:[],errors:[],mediaRequests:[],metadataRequests:[]};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
let page,fixture;

function installNativeProbe(){
 const probe=window.__audioPreviewProbe={workers:[],contexts:[],media:[],starts:[],holdReplies:false};
 const buffers=new WeakMap();let bufferSequence=0;
 const identity=buffer=>{if(!buffers.has(buffer))buffers.set(buffer,++bufferSequence);return buffers.get(buffer);};
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker{
  constructor(url,options){
   super(url,options);
   const row={url:String(url),options,posts:0,replies:0,heldReplies:0,errors:[],terminated:false,analysis:false};probe.workers.push(row);
   this.addEventListener('message',event=>{
    if(!event.data?.measurements)return;
    row.replies++;
    if(probe.holdReplies){row.heldReplies++;event.stopImmediatePropagation();}
   });
   this.addEventListener('error',event=>row.errors.push(event.message||'Worker error'));
   const post=this.postMessage.bind(this),terminate=this.terminate.bind(this);
   this.postMessage=(message,...args)=>{if(Array.isArray(message?.channels)){row.analysis=true;row.posts++;}return post(message,...args);};
   this.terminate=()=>{row.terminated=true;return terminate();};
  }
 };
 const NativeAudioContext=window.AudioContext;
 window.AudioContext=class extends NativeAudioContext{
  constructor(...args){
   super(...args);
   const row={id:probe.contexts.length+1,context:this,decodes:0,closeCalls:0};probe.contexts.push(row);
   const decode=this.decodeAudioData.bind(this),create=this.createBufferSource.bind(this),close=this.close.bind(this);
   this.decodeAudioData=(...args)=>{row.decodes++;return decode(...args);};
   this.createBufferSource=()=>{
    const source=create(),start=source.start.bind(source);
    source.start=(...args)=>{const buffer=source.buffer;probe.starts.push({contextId:row.id,bufferId:identity(buffer),length:buffer.length,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,at:this.currentTime,offset:args[1]||0});return start(...args);};
    return source;
   };
   this.close=()=>{row.closeCalls++;return close();};
  }
 };
 const NativeAudio=window.Audio;
 window.Audio=function(...args){const media=new NativeAudio(...args);probe.media.push(media);return media;};
 window.Audio.prototype=NativeAudio.prototype;
}
async function snapshot(){return page.evaluate(()=>{
 const probe=window.__audioPreviewProbe;
 return {workers:probe.workers.filter(worker=>worker.analysis),contexts:probe.contexts.map(({context,...row})=>({...row,state:context.state,currentTime:context.currentTime})),starts:probe.starts,mainPaused:probe.media[0]?.paused};
});}
async function selectMode(dialog,name){
 const picker=dialog.getByRole('combobox',{name:'Compare with',exact:true});
 await picker.click();
 await page.getByRole('option',{name,exact:true}).click();
 // The top-layer popover can be re-opened by the surrounding label's native
 // activation after an option click. Close that transient state before the
 // next audition control is clicked.
 if(await picker.getAttribute('aria-expanded')==='true')await picker.press('Escape');
 await expect(picker).toHaveAttribute('aria-expanded','false');
 await expect(dialog.getByRole('button',{name:'Play '+name,exact:true})).toBeEnabled();
}
async function closePreview(dialog,contextId){
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(async()=> (await snapshot()).contexts.find(context=>context.id===contextId)?.state).toBe('closed');
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 fixture=await installPerformanceFixture(context,{origin:base,account,catalog,settings:{reducedMotion:true,audioTechnology:'none',audioQuality:'data-saver'}});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  return url.origin===base&&(url.pathname==='/'||url.pathname.startsWith('/s/'))?route.abort('blockedbyclient'):route.fallback();
 });
 await context.route('**/api/v2/library**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:catalog.tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{[catalog.tracks[0].id]:{liked:true,revision:1}}}});
  return route.fallback();
 });
 await context.route('**/api/v2/audio-preview',route=>{
  assert.equal(route.request().method(),'GET');report.metadataRequests.push({path:'/api/v2/audio-preview'});
  return route.fulfill({status:503,json:{error:'No example in this synthetic fixture'}});
 });
 await context.addInitScript(installNativeProbe);
 context.on('request',request=>{const url=new URL(request.url());if(url.hostname==='res.cloudinary.com'||/\/recordings\/[^/]+\/audio$/.test(url.pathname))report.mediaRequests.push({path:url.pathname,method:request.method(),range:request.headers().range||null});});
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
 await page.getByRole('button',{name:'Play '+catalog.tracks[0].title,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__audioPreviewProbe.media[0]?.currentTime>.25&&!window.__audioPreviewProbe.media[0].paused)).toBe(true);
 await page.getByRole('link',{name:'Your listening profile',exact:true}).first().click();
 await page.getByRole('link',{name:'Shape your feed',exact:true}).click();
 await expect.poll(()=>new URL(page.url()).pathname).toBe('/settings');
 const previewButton=page.getByRole('button',{name:'Preview the difference',exact:true});
 let contextBoundary=(await snapshot()).contexts.length;
 await previewButton.click();let dialog=page.getByRole('dialog',{name:'Hear the difference.',exact:true});await expect(dialog).toHaveAttribute('data-dialog-phase','open');
 await dialog.getByRole('button',{name:'Current song',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Play original',exact:true})).toBeEnabled();
 const prepared=await snapshot(),previewContextId=prepared.contexts[contextBoundary].id;
 assert.equal(prepared.workers.length,1);assert.equal(prepared.workers[0].posts,1);assert.equal(prepared.workers[0].replies,1);assert.deepEqual(prepared.workers[0].errors,[]);
 const workerUrl=new URL(prepared.workers[0].url,base);assert.equal(workerUrl.origin,base);assert.ok(workerUrl.pathname.startsWith('/_next/'),'The shipped bundle owns the compiled analysis worker');
 await expect(dialog.getByText(currentSongTitle,{exact:true})).toBeVisible();await expect(dialog.getByRole('img',{name:'Original audio waveform',exact:true}).locator('rect').first()).toBeVisible();
 report.checks.push('Current song opens the selected exact generated recording, decodes it in the Settings context and receives a real compiled DSP worker reply without fallback.');
 const mediaBoundary=report.mediaRequests.length;
 await selectMode(dialog,'Clarity');await dialog.getByRole('button',{name:'Play original',exact:true}).click();
 const position=dialog.getByRole('slider',{name:'Comparison position',exact:true});await expect.poll(async()=>Number(await position.inputValue())).toBeGreaterThan(250);
 const original=(await snapshot()).starts.at(-1),cursor=Number(await position.inputValue());
 await dialog.getByRole('button',{name:'Play Clarity',exact:true}).click();await expect(dialog.getByRole('button',{name:'Pause Clarity',exact:true})).toBeVisible();
 await expect.poll(async()=>Number(await position.inputValue())).toBeGreaterThanOrEqual(cursor);
 assert.notEqual((await snapshot()).starts.at(-1).bufferId,original.bufferId);
 await dialog.getByRole('button',{name:'Pause Clarity',exact:true}).click();await selectMode(dialog,'Warmth');
 await dialog.getByRole('button',{name:'Play original',exact:true}).click();assert.equal((await snapshot()).starts.at(-1).bufferId,original.bufferId);
 await dialog.getByRole('button',{name:'Pause original',exact:true}).click();const beforeReuse=await snapshot();await selectMode(dialog,'Clarity');const reused=await snapshot();
 assert.equal(beforeReuse.workers[0].posts,3);assert.equal(reused.workers[0].posts,3);assert.equal(reused.workers[0].replies,3);assert.equal(report.mediaRequests.length,mediaBoundary);assert.equal(reused.contexts.find(row=>row.id===previewContextId).decodes,1);assert.equal(reused.mainPaused,true);
 report.checks.push('Original and enhanced auditions advance the native context cursor at the same passage. New modes retain the exact original buffer; returning to a prepared mode starts no worker, media fetch or decode.');
 const [fileChooser]=await Promise.all([
  page.waitForEvent('filechooser'),
  dialog.getByRole('button',{name:'Choose audio file',exact:true}).click(),
 ]);
 await fileChooser.setFiles({name:'Generated alternate.wav',mimeType:'audio/wav',buffer:fileBytes});
 await expect(dialog.getByRole('button',{name:'Play original',exact:true})).toBeEnabled();await expect(dialog.getByText('Generated alternate',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Play original',exact:true}).click();const alternate=await snapshot();assert.notEqual(alternate.starts.at(-1).bufferId,original.bufferId);assert.equal(alternate.contexts.find(row=>row.id===previewContextId).decodes,2);assert.equal(report.mediaRequests.length,mediaBoundary);
 report.checks.push('A generated device file replaces the immutable source, obtains its own worker measurements and original audition buffer, and uploads or refetches no audio.');
 await page.evaluate(()=>window.__audioPreviewProbe.holdReplies=true);
 await dialog.getByLabel('Choose a comparison audio file',{exact:true}).setInputFiles({name:'Canceled generated file.wav',mimeType:'audio/wav',buffer:catalog.wav});
 await expect.poll(async()=> (await snapshot()).workers[0].heldReplies).toBe(1);await closePreview(dialog,previewContextId);
 const canceled=await snapshot();assert.equal(canceled.workers[0].terminated,true);assert.equal(canceled.contexts.find(row=>row.id===previewContextId).closeCalls,1);assert.equal(canceled.mainPaused,true);
 await page.evaluate(()=>window.__audioPreviewProbe.holdReplies=false);contextBoundary=canceled.contexts.length;
 await previewButton.click();dialog=page.getByRole('dialog',{name:'Hear the difference.',exact:true});await expect(dialog).toHaveAttribute('data-dialog-phase','open');await dialog.getByRole('button',{name:'Current song',exact:true}).click();await expect(dialog.getByRole('button',{name:'Play original',exact:true})).toBeEnabled();
 const reopened=await snapshot(),reopenedContextId=reopened.contexts[contextBoundary].id;assert.equal(reopened.workers.length,2);assert.equal(reopened.workers[1].replies,1);assert.deepEqual(reopened.workers[1].errors,[]);await expect(dialog.getByText(currentSongTitle,{exact:true})).toBeVisible();
 await closePreview(dialog,reopenedContextId);report.native=await snapshot();assert.ok(report.native.workers.every(worker=>worker.terminated&&worker.errors.length===0));
 report.checks.push('Closing with a held real worker response terminates the owned worker and closes its context. Reopening receives the current song through a fresh worker/context, then releases both again.');
 assert.deepEqual(fixture.unexpected,[]);assert.deepEqual(report.errors,[]);report.requests={api:fixture.requests,unexpected:fixture.unexpected};report.status='passed';
 await page.screenshot({path:output+'/result.png'});await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,workers:report.native.workers,contexts:report.native.contexts},null,2));
}catch(error){report.status='failed';report.failure=String(error);report.native=await snapshot().catch(()=>null);if(page)await page.screenshot({path:output+'/failure.png'}).catch(()=>{});await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');throw error;}
finally{await browser.close();}
