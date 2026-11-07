/** Live app UI, synthetic account cookie, explicitly mocked catalog/audio; no listening writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const base=process.env.SAKURA_TEST_URL||'http://localhost:3000';
const session=JSON.parse(await fs.readFile('.local/rebuild-test-account.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const tracks=Array.from({length:40},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,title:`Quiet song ${i}`,artists:['Synthetic touch fixture'],artistId:null,durationMs:60000,coverUrl:null,albumTitle:'Touch verification',versionLabel:'Original recording',reference:{provider:'deezer',id:String(i+1)},references:[{provider:'deezer',id:String(i+1)}]}));
const rate=8000,count=rate*60,wav=Buffer.alloc(44+count*2);wav.write('RIFF',0);wav.writeUInt32LE(36+count*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++)wav.writeInt16LE(Math.round(Math.sin(i/rate*220*Math.PI*2)*200),44+i*2);
const report=[];
let debugPage=null;
try{
 for(const width of [320,390,1440])for(const theme of ['light','dark']){
  const height=width===1440?1000:844;
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<500,isMobile:width<500,colorScheme:theme,reducedMotion:'reduce'});
  await context.addCookies(session.cookie.split('; ').map(value=>{const i=value.indexOf('=');return{name:value.slice(0,i),value:value.slice(i+1),url:base};}));
  await context.addInitScript(()=>{const OriginalAudio=window.Audio;window.Audio=function(...args){const audio=new OriginalAudio(...args);window.__touchAudio=audio;return audio;};window.Audio.prototype=OriginalAudio.prototype;const time=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');window.__touchSeeks=[];Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...time,set(value){window.__touchSeeks.push(value);time.set.call(this,value);}});sessionStorage.setItem('sakura-ink-opening','1');});
  const page=await context.newPage();debugPage=page;page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v2/home',route=>route.fulfill({json:{featured:tracks,mixes:[],recent:[],needsOnboarding:false}}));
  await page.route('**/api/v2/settings',route=>route.fulfill({json:{theme,privateSession:true,reducedMotion:true,onboarded:true,seedArtists:[],seedGenres:[]}}));
  await page.route('**/api/v2/library?kind=liked*',route=>route.fulfill({json:{recordings:[]}}));
  let favoritePosts=0;
  await page.route('**/api/v2/library',route=>route.request().method()==='POST'&&favoritePosts++===0?route.fulfill({status:503,contentType:'text/html',body:'<html>DatabasePoolTimeout private exception detail</html>'}):route.fulfill({json:{liked:true}}));
  let resolverGate=null,heldRequests=0;
  await page.route('**/api/v2/recordings/resolve',async route=>{const request=route.request().postDataJSON();const track=tracks.find(t=>t.reference.id===request.reference.id)||tracks[0];const held=track.id===tracks[7].id&&resolverGate;if(held){heldRequests++;await held.wait;}const completion=route.fulfill({json:{status:'resolved',recording:{recordingId:track.id,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs},references:track.references},playback:{url:'/fixture-touch.wav',assetId:'fixture-touch',sizeBytes:wav.length}}});if(held)await completion.catch(()=>{});else await completion;});
  let playlistReads=0,playlistWrites=0;
  await page.route('**/api/v2/playlists',route=>playlistReads++===0?route.fulfill({status:503,contentType:'text/html',body:'<html>DatabasePoolTimeout secret diagnostic</html>'}):route.fulfill({json:{playlists:[{id:'synthetic-touch-playlist',name:'A quiet collection'}]}}));
  await page.route('**/api/v2/playlists/synthetic-touch-playlist/tracks',route=>playlistWrites++===0?route.fulfill({status:503,contentType:'text/html',body:'<html>Private connection failure</html>'}):route.fulfill({json:{added:1}}));
  await page.route('**/fixture-touch.wav',route=>{const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});});
  await page.route('**/api/v2/lyrics?*',route=>route.fulfill({json:{status:'matched',provider:'synthetic-fixture',providerTrackId:1,schemaVersion:'verified-lyrics-v1',timing:'synced',lines:Array.from({length:50},(_,i)=>({text:`Quiet lyric line ${i}`,start:i*1.2,end:(i+1)*1.2}))}}));
  await page.goto(base+'/home',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Find my soundtrack'}).click({timeout:60000});
  await page.getByRole('button',{name:'Open now playing'}).waitFor();
  async function options(i){const button=page.getByRole('button',{name:`More options for Quiet song ${i}`,exact:true});await button.click();await page.getByRole('menu').waitFor();return button;}
  const trigger=await options(3);
  assert.equal(await page.locator('dialog[open]').count(),0,'song options are a popover');
  const rect=await page.getByRole('menu').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,focus:element.contains(document.activeElement)};});
  assert.ok(rect.left>=0&&rect.right<=width+1&&rect.top>=0&&rect.bottom<=height+1,'popover fits viewport');assert.ok(rect.focus);
  await page.keyboard.press('ArrowDown');assert.match(await page.evaluate(()=>document.activeElement.textContent),/Add to queue/);await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'detached'});assert.ok(await trigger.evaluate(element=>element===document.activeElement),'Escape returns focus to trigger');
  for(const i of [3,4,3]){await options(i);await page.getByRole('menuitem',{name:'Add to queue',exact:true}).click();}
  await page.locator('button[aria-label="Open queue"]:visible').first().click();
  const manual=page.getByRole('region',{name:'Added by you',exact:true});
  assert.deepEqual(await manual.locator('li strong').allTextContents(),['Quiet song 3','Quiet song 4','Quiet song 3']);
  await manual.getByRole('button',{name:'Move Quiet song 4 earlier',exact:true}).click();
  assert.deepEqual(await manual.locator('li strong').allTextContents(),['Quiet song 4','Quiet song 3','Quiet song 3']);
  await manual.locator('li').last().scrollIntoViewIfNeeded();
  const handle=manual.getByRole('button',{name:'Drag to reorder Quiet song 4',exact:true});const handleBox=await handle.boundingBox();const lastBox=await manual.locator('li').last().boundingBox();
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(handleBox.x+handleBox.width/2,lastBox.y+lastBox.height*.7,{steps:8});await page.mouse.up();
  assert.deepEqual(await manual.locator('li strong').allTextContents(),['Quiet song 3','Quiet song 3','Quiet song 4'],'drag uses exact occurrence');
  assert.equal(await handle.evaluate(element=>getComputedStyle(element).touchAction),'none','touch grip cancels browser panning');
  if(width<500){
   const cdp=await context.newCDPSession(page);const from=await handle.boundingBox();const to=await manual.locator('li').first().boundingBox();const x=from.x+from.width/2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from.y+from.height/2}]});
   for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from.y+from.height/2+(to.y+20-from.y-from.height/2)*step/8}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   assert.deepEqual(await manual.locator('li strong').allTextContents(),['Quiet song 4','Quiet song 3','Quiet song 3'],'native touch drag reorders');
   await manual.getByRole('button',{name:'Move Quiet song 4 later',exact:true}).click();await manual.getByRole('button',{name:'Move Quiet song 4 later',exact:true}).click();
  }
  await manual.getByRole('button',{name:'Remove Quiet song 3 from queue',exact:true}).last().click();assert.deepEqual(await manual.locator('li strong').allTextContents(),['Quiet song 3','Quiet song 4']);
  await page.screenshot({path:`.local/rebuild-queue-priority-${width}-${theme}.png`});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Open now playing'}).click();await page.locator('dialog').getByRole('button',{name:'Next song',exact:true}).click();
  await page.locator('dialog h1').filter({hasText:'Quiet song 3'}).waitFor();await page.locator('dialog').getByRole('button',{name:'Up next',exact:true}).click();
  await page.locator('dialog').getByRole('button',{name:'Clear queue',exact:true}).click();assert.equal(await page.locator('dialog li').count(),0);assert.match(await page.locator('dialog [aria-current="true"]').textContent(),/Quiet song 3/);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Open now playing'}).click();
  async function fullscreen(name){const result=await page.locator('dialog[open]').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};});assert.equal(Math.round(result.width),width,`${name} fills width`);assert.equal(Math.round(result.height),height,`${name} fills height`);assert.ok(result.scrollWidth<=result.clientWidth+1,`${name} no overflow`);await page.screenshot({path:`.local/rebuild-${name}-fullscreen-${width}-${theme}.png`});return result;}
  const player=await fullscreen('player');
  await page.locator('dialog').getByRole('button',{name:'Mute audio',exact:true}).click();assert.equal(await page.locator('dialog').getByRole('slider',{name:'Volume',exact:true}).inputValue(),'0');await page.locator('dialog').getByRole('button',{name:'Unmute audio',exact:true}).click();assert.ok(Number(await page.locator('dialog').getByRole('slider',{name:'Volume',exact:true}).inputValue())>0);
  await page.locator('dialog').getByRole('button',{name:'Like this song',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Save again',exact:true}).waitFor();assert.ok(!(await page.locator('dialog').textContent()).includes('DatabasePoolTimeout'),'raw backend text hidden inside modal');await page.locator('dialog').getByRole('button',{name:'Save again',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Remove from liked songs',exact:true}).waitFor();
  await page.locator('dialog').getByRole('button',{name:'Lyrics',exact:true}).click();await page.getByRole('button',{name:'Quiet lyric line 0',exact:true}).waitFor();
  await page.locator('dialog').getByRole('button',{name:'Pause',exact:true}).click();
  await page.locator('[data-player-scroll]').hover();await page.mouse.wheel(0,300);await page.getByRole('button',{name:'Quiet lyric line 32',exact:true}).click();
  await page.locator('dialog button[aria-current="true"]').filter({hasText:'Quiet lyric line 32'}).waitFor();
  assert.ok(await page.locator('[data-player-scroll]').evaluate(element=>element.scrollTop>100),'synced lyrics follow seek');
  const lyrics=await fullscreen('lyrics');await page.locator('dialog').getByRole('button',{name:'Select lines',exact:true}).click();await page.getByRole('button',{name:'Quiet lyric line 30',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Quiet lyric line 30',exact:true}).getAttribute('aria-pressed'),'true');await page.keyboard.press('Escape');
  if(width<500){
   const row=page.locator(`[data-song-id="${tracks[2].id}"]`);await row.scrollIntoViewIfNeeded();const box=await row.boundingBox();const point={pointerId:41,pointerType:'touch',button:0,clientX:box.x+120,clientY:box.y+box.height/2};
   await row.dispatchEvent('pointerdown',point);await page.waitForTimeout(520);await row.dispatchEvent('pointerup',point);await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
   await row.dispatchEvent('pointerdown',point);await row.dispatchEvent('pointermove',{...point,clientY:point.clientY+30});await page.waitForTimeout(520);await row.dispatchEvent('pointerup',{...point,clientY:point.clientY+30});assert.equal(await page.getByRole('menu').count(),0,'scroll movement cancels hold');
  }
  await options(5);assert.equal(await page.getByRole('menu').getByRole('link',{name:'Synthetic touch fixture',exact:true}).getAttribute('href'),'/search?q=Synthetic%20touch%20fixture&tab=Artists','unidentified artists still lead to artist search');
  await page.getByRole('menuitem',{name:'Add to playlist',exact:true}).click();await page.getByRole('menu').getByRole('alert').waitFor();assert.ok(!(await page.getByRole('menu').textContent()).includes('DatabasePoolTimeout'));await page.getByRole('menuitem',{name:'Reconnect',exact:true}).click();await page.getByRole('menuitem',{name:'A quiet collection',exact:true}).click();await page.getByRole('menu').getByRole('alert').waitFor();await page.getByRole('menuitem',{name:'Save again',exact:true}).click();await page.getByRole('menu').waitFor({state:'detached'});assert.equal(playlistWrites,2,'playlist failure retries in the anchored menu');
  function holdResolver(){let release;const wait=new Promise(resolve=>release=resolve);resolverGate={wait,release};return resolverGate;}
  const firstGate=holdResolver();await page.getByRole('button',{name:'Play Quiet song 7',exact:true}).click();await page.waitForFunction(()=>window.__touchAudio.paused&&!window.__touchAudio.getAttribute('src'));await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Pause loading',exact:true}).waitFor();await expect.poll(()=>heldRequests,{timeout:15000}).toBe(1);
  await page.locator('dialog').getByRole('button',{name:'Pause loading',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Play',exact:true}).waitFor();resolverGate=null;firstGate.release();await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>window.__touchAudio.paused&&!window.__touchAudio.getAttribute('src')),'cancelled resolver cannot restart old audio');assert.equal(await page.locator('dialog h1').textContent(),'Quiet song 7');
  const secondGate=holdResolver();await page.locator('dialog').getByRole('button',{name:'Play',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Pause loading',exact:true}).waitFor();await expect.poll(()=>heldRequests,{timeout:15000}).toBe(2);resolverGate=null;secondGate.release();await page.locator('dialog').getByRole('button',{name:'Pause',exact:true}).waitFor();await page.waitForFunction(()=>!window.__touchAudio.paused&&window.__touchAudio.currentTime>0);assert.equal(await page.locator('dialog h1').textContent(),'Quiet song 7','retry plays the selected pending song');await page.locator('dialog').getByRole('button',{name:'Pause',exact:true}).click();
  assert.deepEqual(errors,[]);report.push({width,theme,manualFIFO:true,duplicateOccurrenceReorder:true,clearPreservesCurrent:true,popoverKeyboard:true,volumeMute:true,dialogRecovery:true,playlistRecovery:true,pendingPauseRetry:true,artistMenuLink:true,fullscreen:{player,lyrics},touch:width<500});await context.close();console.log(`Verified touch/queue/player ${width}px ${theme}`);
 }
 await fs.writeFile('.local/rebuild-touch-report.json',JSON.stringify({checkedAt:new Date().toISOString(),fixtures:'mocked audio/catalog, live synthetic authentication',checks:report},null,2));
}catch(error){if(debugPage&&!debugPage.isClosed()){await debugPage.screenshot({path:'.local/rebuild-touch-failure.png'}).catch(()=>{});console.log(await debugPage.evaluate(()=>({menus:document.querySelectorAll('[role="menu"]').length,popovers:Array.from(document.querySelectorAll('[popover]')).map(e=>({open:e.matches(':popover-open'),display:getComputedStyle(e).display,rect:JSON.stringify(e.getBoundingClientRect())})),optionTriggers:document.querySelectorAll('button[aria-haspopup]').length,audio:window.__touchAudio?{time:window.__touchAudio.currentTime,duration:window.__touchAudio.duration,ready:window.__touchAudio.readyState,seekable:window.__touchAudio.seekable.length,end:window.__touchAudio.seekable.length?window.__touchAudio.seekable.end(0):null,seeks:window.__touchSeeks}:null})));}throw error;}finally{await browser.close();}
