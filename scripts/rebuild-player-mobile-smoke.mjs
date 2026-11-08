/** Real production dialogs with live authentication and explicit media/catalog fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.SAKURA_TEST_URL||'http://localhost:3000';
const session=JSON.parse(await fs.readFile('.local/rebuild-test-account.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const report=[];
const tracks=Array.from({length:40},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:i?'A long song title for a narrow phone '+i:'東京へ行く',artists:['Synthetic browser fixture'],durationMs:30000,coverUrl:null,albumTitle:'Mobile dialog verification',versionLabel:'Original recording',reference:{provider:'deezer',id:String(i+1)},references:[{provider:'deezer',id:String(i+1)}]}));
const rate=22050,count=rate*30,bytes=Buffer.alloc(44+count*2);bytes.write('RIFF',0);bytes.writeUInt32LE(36+count*2,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++)bytes.writeInt16LE(Math.round(Math.sin(i/rate*440*Math.PI*2)*500),44+i*2);
try{
 for(const width of [320,390])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme,reducedMotion:'reduce'});
  await context.addCookies(session.cookie.split('; ').map(value=>{const i=value.indexOf('=');return {name:value.slice(0,i),value:value.slice(i+1),url:base};}));
  await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v2/home',r=>r.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}}));
  await page.route('**/api/v2/settings',r=>r.fulfill({json:{theme,privateSession:true,reducedMotion:true,onboarded:true,seedArtists:[],seedGenres:[]}}));
  await page.route('**/api/v2/recordings/resolve',async r=>{
   const input=r.request().postDataJSON();const track=tracks.find(t=>t.reference.id===input.reference.id)||tracks[0];
   await r.fulfill({json:{status:'resolved',recording:{recordingId:track.id,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs},references:track.references},playback:{url:'/fixture-dialog.wav',assetId:'fixture',sizeBytes:bytes.length}}});
  });
  await page.route('**/fixture-dialog.wav',r=>r.fulfill({body:bytes,contentType:'audio/wav'}));
  await page.route('**/api/v2/lyrics?*',r=>r.fulfill({json:{status:'matched',provider:'synthetic-fixture',providerTrackId:1,schemaVersion:'verified-lyrics-v1',timing:'synced',lines:Array.from({length:40},(_,i)=>({text:i?'These actual selected fixture words '+i:'東京へ行く',start:i*.5,end:(i+1)*.5}))}}));
  await page.route('**/api/v2/readings',r=>r.fulfill({json:{error:'Reading engine checked separately through real HTTP'},status:503}));
  await page.goto(base+'/home');await page.getByRole('button',{name:'Find my soundtrack'}).click({timeout:60000});
  await page.getByRole('button',{name:'Open now playing'}).waitFor();
  await page.getByRole('button',{name:'Open now playing'}).click();
  await page.locator('dialog').getByRole('button',{name:'Pause',exact:true}).click();
  async function inspect(name){
   const dialog=page.locator('dialog[open]').last();await dialog.waitFor();
   const result=await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,bodyOverflow:document.body.style.overflow,focusedInside:e.contains(document.activeElement),theme:document.documentElement.dataset.inkTheme,color:getComputedStyle(e).backgroundColor};});
   assert.ok(result.left>=-1&&result.right<=width+1,`${name} fits ${width}px`);assert.ok(result.top>=-1&&result.bottom<=845,`${name} fits height`);assert.ok(result.scrollWidth<=result.clientWidth+1,`${name} has no horizontal overflow`);assert.equal(result.bodyOverflow,'hidden');assert.equal(result.focusedInside,true);assert.equal(result.theme,theme);
   await page.screenshot({path:`.local/rebuild-${name}-${width}-${theme}.png`});return {name,...result};
  }
  const dialogs=[await inspect('player')];
  await page.getByRole('button',{name:'Up next',exact:true}).click();dialogs.push(await inspect('queue'));assert.equal(await page.locator('dialog[open]').count(),2);
  assert.equal(await page.locator('dialog[open]').last().locator('ol>li').count(),39);
  await page.locator('dialog[open]').last().locator('[data-player-scroll]').evaluate(element=>{element.scrollTop=160;});
  await page.locator('dialog[open]').last().getByRole('button',{name:'Move A long song title for a narrow phone 2 earlier',exact:true}).click();
  await page.locator('dialog[open]').last().getByRole('button',{name:'Remove A long song title for a narrow phone 3 from queue',exact:true}).click();assert.equal(await page.locator('dialog[open]').last().locator('ol>li').count(),38);
  const currentCount=await page.locator('dialog[open]').last().locator('[aria-current="true"]').count();assert.equal(currentCount,1);
  await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor();assert.equal(await page.locator('dialog[open]').count(),1);
  await page.locator('dialog[open]').getByRole('button',{name:'Lyrics',exact:true}).click();dialogs.push(await inspect('lyrics'));assert.equal(await page.locator('dialog[open]').count(),2);
  await page.locator('dialog[open]').last().getByRole('button',{name:'Share lyrics',exact:true}).click();await page.locator('dialog[open]').last().getByRole('button',{name:'東京へ行く',exact:true}).click();await page.locator('dialog[open]').last().getByRole('button',{name:'Share 1 lines',exact:true}).click();dialogs.push(await inspect('share'));
  await page.locator('dialog[open]').last().locator('img').waitFor({timeout:30000});assert.ok((await page.locator('dialog[open]').last().locator('img').getAttribute('alt')).includes('東京へ行く'));
  await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor();assert.equal(await page.locator('dialog[open]').count(),1);
  await page.locator('dialog[open]').getByRole('button',{name:'Close',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.deepEqual(errors,[]);report.push({width,theme,dialogs,upcomingCount:38,oneCurrentOccurrence:true,auth:'live synthetic account',catalogAndMedia:'explicit browser fixtures'});await context.close();
 }
 await fs.writeFile('.local/rebuild-player-mobile-report.json',JSON.stringify({checkedAt:new Date().toISOString(),checks:report},null,2));console.log(JSON.stringify({variants:report.length,dialogs:report.length*4,queue:'current + 39 upcoming entries, exact move/remove',overflow:false,focus:true,themes:['light','dark'],catalogAndMedia:'explicit browser fixtures'}));
}finally{await browser.close();}
