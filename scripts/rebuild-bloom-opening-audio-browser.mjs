/** Native Chrome regression for the opening soundtrack's React lifecycle.
 * Covers gesture permission, one-shot playback, Activity route retention,
 * interruption, mute/pause and cleanup. No server or database is used.
 * Run: node scripts/rebuild-bloom-opening-audio-browser.mjs
 * Evidence: .local/bloom-opening-audio/lifecycle-report.json
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=fileURLToPath(new URL('../.local/bloom-opening-audio/',import.meta.url));
await fs.mkdir(output,{recursive:true});
// esbuild is already installed through the project's tsx dependency.
const {outputFiles}=await build({stdin:{contents:`
import React,{Activity,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useBloomOpeningAudio} from './src/rebuild/bloom/useBloomOpeningAudio';
function Review(){
 const [active,setActive]=useState(true),[muted,setMuted]=useState(false),[paused,setPaused]=useState(false);
 const audio=useBloomOpeningAudio({world:'china',active,muted,paused,seed:12345});
 window.audioReview={audio,setActive,setMuted,setPaused};
 return <><button id="play" onClick={audio.play}>Play</button><button id="passive" onClick={audio.unlock}>Unrelated gesture</button><button id="mute" onClick={()=>setMuted(value=>!value)}>Mute</button><output id="state">{audio.playing?'playing':'quiet'}</output></>;
}
function RetainedRoute(){
 const [hidden,setHidden]=useState(false);window.setReviewHidden=setHidden;
 return <Activity mode={hidden?'hidden':'visible'}><Review/></Activity>;
}
window.reviewRoot=createRoot(document.getElementById('root'));window.reviewRoot.render(<RetainedRoute/>);
`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});

const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
async function room(kind='normal'){
 const context=await browser.newContext();
 await context.addInitScript(({kind})=>{
  const Native=window.AudioContext;window.reviewContexts=[];window.delayedResume=[];
  window.AudioContext=class extends Native{
   constructor(...args){super(...args);window.reviewContexts.push(this);}
   resume(){
    if(kind==='reject')return Promise.reject(new Error('Permission rejected'));
    if(kind==='late')return new Promise(resolve=>window.delayedResume.push(()=>{super.resume().then(resolve).catch(()=>resolve());}));
    return super.resume();
   }
  };
 },{kind});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('about:blank');await page.setContent('<div id="root"></div>');await page.addScriptTag({content:outputFiles[0].text});await page.locator('#play').waitFor();
 return {context,page,errors};
}
const allClosed=page=>page.evaluate(()=>window.reviewContexts.every(context=>context.state==='closed'));
async function retainedEntrance(page,label){
 const count=await page.evaluate(()=>window.reviewContexts.length);
 await page.evaluate(()=>window.setReviewHidden(true));
 await expect(page.locator('#play')).toBeHidden();
 await expect.poll(()=>allClosed(page)).toBe(true);
 await page.evaluate(()=>window.setReviewHidden(false));
 await expect(page.locator('#play')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.reviewContexts.length)).toBe(count+1);
 await expect.poll(()=>page.evaluate(()=>window.reviewContexts.at(-1).state)).toBe('running');
 await expect(page.locator('#state')).toHaveText('playing');
 report.push({case:label,passed:true});
}

try{
 const first=await room();
 await first.page.locator('#play').click();await expect(first.page.locator('#state')).toHaveText('playing');
 await expect.poll(()=>allClosed(first.page),{timeout:22000}).toBe(true);
 const count=await first.page.evaluate(()=>window.reviewContexts.length);
 await first.page.locator('#passive').click();await first.page.waitForTimeout(200);
 assert.equal(await first.page.evaluate(()=>window.reviewContexts.length),count,'passive gesture cannot replay a finished welcome');
 await retainedEntrance(first.page,'Activity revisit after natural score completion');
 await first.page.locator('#mute').click();await expect.poll(()=>allClosed(first.page)).toBe(true);
 await first.page.locator('#mute').click();await expect(first.page.locator('#state')).toHaveText('playing');
 await retainedEntrance(first.page,'Activity hide closes a playing score and revisit creates a fresh entrance');
 await first.page.evaluate(()=>window.audioReview.audio.stop());await expect.poll(()=>allClosed(first.page)).toBe(true);
 await retainedEntrance(first.page,'Activity revisit after manually closing the opening');
 console.log('Verified natural completion, passive suppression and Activity revisits');

 await first.page.evaluate(()=>window.reviewContexts.at(-1).suspend());await expect(first.page.locator('#state')).toHaveText('quiet');
 await first.page.waitForTimeout(19000);
 assert.equal(await first.page.evaluate(()=>window.reviewContexts.at(-1).state),'suspended','system suspension survives the old wall-clock deadline');
 await first.page.evaluate(()=>window.reviewContexts.at(-1).resume());await expect(first.page.locator('#state')).toHaveText('playing');
 await first.page.locator('#mute').click();await expect.poll(()=>allClosed(first.page)).toBe(true);
 await first.page.locator('#mute').click();await expect(first.page.locator('#state')).toHaveText('playing');
 await first.page.evaluate(()=>window.audioReview.setPaused(true));await expect(first.page.locator('#state')).toHaveText('quiet');
 await expect.poll(()=>first.page.evaluate(()=>window.reviewContexts.at(-1).state)).toBe('suspended');
 await first.page.evaluate(()=>window.audioReview.setPaused(false));await expect(first.page.locator('#state')).toHaveText('playing');
 await first.page.evaluate(()=>window.audioReview.setActive(false));await expect.poll(()=>allClosed(first.page)).toBe(true);
 await first.page.evaluate(()=>window.reviewRoot.unmount());assert.deepEqual(first.errors,[]);
 report.push({case:'system suspension, mute, pause and scene transfer',passed:true});await first.context.close();

 // A separate entrance explicitly replays a completed score without needing
 // a route transition. Keep this distinct from passive gesture suppression.
 const replay=await room();await replay.page.locator('#play').click();
 await expect(replay.page.locator('#state')).toHaveText('playing');
 await expect.poll(()=>allClosed(replay.page),{timeout:22000}).toBe(true);
 const finishedCount=await replay.page.evaluate(()=>window.reviewContexts.length);
 await replay.page.locator('#play').click();await expect(replay.page.locator('#state')).toHaveText('playing');
 assert.equal(await replay.page.evaluate(()=>window.reviewContexts.length),finishedCount+1,'explicit sound action replays');
 await replay.page.evaluate(()=>window.reviewRoot.unmount());await expect.poll(()=>allClosed(replay.page)).toBe(true);
 assert.deepEqual(replay.errors,[]);report.push({case:'explicit replay and unmount cleanup',passed:true});await replay.context.close();

 for(const kind of ['reject','late']){
  const fixture=await room(kind);await fixture.page.locator('#play').click();
  if(kind==='late'){await fixture.page.locator('#mute').click();await fixture.page.evaluate(()=>window.delayedResume.forEach(resolve=>resolve()));}
  await expect.poll(()=>allClosed(fixture.page)).toBe(true);
  await expect(fixture.page.locator('#state')).toHaveText('quiet');
  assert.deepEqual(fixture.errors,[]);report.push({case:kind==='reject'?'rejected resume':'late resume after mute',passed:true});await fixture.context.close();
 }
 console.log(JSON.stringify(report));
}catch(error){report.push({case:'failure',passed:false,error:String(error)});throw error;}
finally{await fs.writeFile(`${output}lifecycle-report.json`,JSON.stringify(report,null,2));await browser.close();}
