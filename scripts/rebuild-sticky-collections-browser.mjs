/** Real collection/search interactions with synthetic authentication and intercepted APIs only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3000';
const expect=baseExpect.configure({timeout:20000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000381',username:'Gesture fixture',email:'gestures@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const collectionId='90000000-0000-4000-8000-000000000382';
const tracks=Array.from({length:48},(_,index)=>({id:`80000000-0000-4000-8000-${String(380+index).padStart(12,'0')}`,title:`Quiet song ${index+1}`,artists:['A familiar voice'],albumTitle:'Small hours',durationMs:180000,versionLabel:'Original recording',coverUrl:null,reference:{provider:'deezer',id:String(380+index)},references:[{provider:'deezer',id:String(380+index)}],addedAt:'2026-03-01T00:00:00Z'}));
const wav=Buffer.alloc(44+48000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
const sha=createHash('sha256').update(wav).digest('hex');
const output='.local/sticky-collections';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={checks:[],errors:[]};
try{
 for(const width of [320,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<700,isMobile:width<700,serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');});
  const settings={theme:'light',audioTechnology:'none',audioQuality:'balanced',privateSession:true,reducedMotion:false,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],volume:.4,shuffle:false,repeat:'off',bloomPerformance:'auto'};
  await context.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:Object.fromEntries(tracks.map(track=>[track.id,{liked:true,revision:1}]))}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/settings'){if(request.method()==='PATCH')Object.assign(settings,request.postDataJSON());return route.fulfill({json:settings});}
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,tracks,likedRecordingIds:tracks.map(track=>track.id),playlists:[{id:collectionId,name:'Small hours',trackCount:tracks.length}],nextCursor:null}});
   if(path==='/api/v2/search')return route.fulfill({json:{tracks,artists:[],albums:[],totals:{tracks:tracks.length},nextCursors:{tracks:null}}});
   if(path==='/api/v2/mixes')return route.fulfill({json:{mixes:[{id:collectionId,name:'Small hours mix',status:'ready',trackCount:tracks.length}]}});
   if(/^\/api\/v2\/(playlists|mixes|albums|artists)\/[^/]+$/.test(path))return route.fulfill({json:{id:collectionId,name:'Small hours',description:'A collection for quiet evenings.',recordings:tracks,tracks,albums:[],playability:'ready'}});
   if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
   if(path==='/api/v2/lyrics')return route.fulfill({json:{lines:[],timing:'plain',schemaVersion:'verified-lyrics-v1'}});
   return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
  for(const path of ['/search?q=Quiet','/library','/liked',`/playlist/${collectionId}`,`/mix/${collectionId}`,`/album/${collectionId}`,`/artist/${collectionId}`,'/library/downloaded']){
   console.log(`Sticky controls ${width}px ${path}`);
   await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});
   const dock=page.locator('[data-sticky-search]');await expect(dock).toBeVisible();
   await expect(dock.locator('[data-collection-toolbar], [data-sort-controls], [data-collection-layout], [data-song-count]')).toHaveCount(0);
   await expect(dock.getByRole('button',{name:/^(Songs|Artists|Albums)$/})).toHaveCount(0);
   await expect(page.locator('[data-track-layout] [data-song-id]')).toHaveCount(tracks.length);
   const field=dock.locator('input').first();
   await field.evaluate(element=>{window.stickyOriginalField=element;});
   await expect(dock).not.toHaveAttribute('data-docked');
   await page.locator('#music-main').evaluate(element=>{element.scrollTop=1100;});
   await expect(dock).toHaveAttribute('data-docked','true');
   const bounds=await dock.evaluate(element=>({dock:element.getBoundingClientRect().toJSON(),root:document.querySelector('#music-main').getBoundingClientRect().toJSON()}));
   assert.ok(Math.abs(bounds.dock.top-bounds.root.top)<=1,'Search docks immediately below navbar');
   assert.ok(bounds.dock.height<=45,'Docked search stays a compact single field');
   assert.equal(await dock.evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)','No added panel background');
   const toolbar=page.locator('[data-collection-toolbar]').first();
   assert.ok((await toolbar.boundingBox()).y+ (await toolbar.boundingBox()).height < bounds.root.top,'Sort and layout controls scroll away with the page');
   assert.equal(await field.evaluate(element=>element===window.stickyOriginalField),true,'Docking preserves original field DOM');
   await field.focus();await field.evaluate(element=>{element.setSelectionRange(0,Math.min(3,element.value.length));});
   await page.locator('#music-main').evaluate(element=>{element.scrollTop+=250;});
   assert.equal(await field.evaluate(element=>element===document.activeElement),true,'Focus survives scroll while docked');
   const sizes=await page.evaluate(()=>{const root=document.querySelector('#music-main');return {document:document.documentElement.scrollWidth,viewport:innerWidth,scroll:root.scrollWidth,client:root.clientWidth};});
   assert.ok(sizes.document<=sizes.viewport+1&&sizes.scroll<=sizes.client+1,'Sticky controls fit viewport');
   if(path==='/liked'||path.startsWith('/mix/')){await page.waitForTimeout(900);await page.screenshot({path:`${output}/${width}-${path==='/liked'?'liked':'mix'}-docked.png`});}
   await page.locator('#music-main').evaluate(element=>{element.scrollTop=0;});
   await expect(dock).not.toHaveAttribute('data-docked');
   report.checks.push(`${width}px ${path}: natural/docked/restored search, original field, retained focus, no horizontal overflow`);
   if(path==='/liked'){
    const rows=page.locator('[data-track-layout]');
    const sizing=await rows.evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight,maxHeight:getComputedStyle(element).maxHeight,overflowY:getComputedStyle(element).overflowY}));
    assert.equal(sizing.maxHeight,'none');assert.equal(sizing.overflowY,'visible');assert.ok(sizing.height>900,'Rows grow beyond the viewport height');
    const before=await page.locator('#music-main').evaluate(element=>element.scrollTop);
    const rowBox=await rows.locator('[data-song-id]').first().boundingBox();await page.mouse.move(rowBox.x+50,rowBox.y+30);await page.mouse.wheel(0,400);
    await expect.poll(()=>page.locator('#music-main').evaluate(element=>element.scrollTop)).toBeGreaterThan(before);
    assert.equal(await rows.evaluate(element=>element.scrollTop),0,'Liked rows use page scrolling without an inner scroll container');
    await page.locator('#music-main').evaluate(element=>{element.scrollTop=0;});
    report.checks.push(`${width}px liked rows: natural list height and page-owned wheel scrolling`);
    for(const layout of ['cards','compact','list']){
     await page.getByRole('button',{name:layout[0].toUpperCase()+layout.slice(1)+' layout',exact:true}).click();
     await expect(rows).toHaveAttribute('data-track-layout',layout);
     for(const height of [620,1040]){
      await page.setViewportSize({width,height});
      const flow=await rows.evaluate(element=>({overflow:getComputedStyle(element).overflowY,maxHeight:getComputedStyle(element).maxHeight,height:element.clientHeight,scroll:element.scrollHeight}));
      assert.equal(flow.overflow,'visible');assert.equal(flow.maxHeight,'none');assert.ok(Math.abs(flow.height-flow.scroll)<=1,'Each track layout grows with its rows');
     }
    }
    await page.setViewportSize({width,height:900});await page.locator('#music-main').evaluate(element=>{element.scrollTop=0;});
    report.checks.push(`${width}px liked rows: list/card/compact layouts retain natural height at 620px and 1040px viewport heights`);
   }
   if(path==='/search?q=Quiet')await page.evaluate(async input=>{
    const bytes=Uint8Array.from(atob(input.audio),character=>character.charCodeAt(0));
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('entries'))request.result.createObjectStore('entries');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');for(const track of input.tracks)tx.objectStore('entries').put({track,blob:new Blob([bytes],{type:'audio/wav'}),sizeBytes:bytes.length,sha256:input.sha,savedAt:Date.parse(track.addedAt),requested:true},`account:${input.accountId}:audio:${track.id}`);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
   },{accountId:account.id,tracks,audio:wav.toString('base64'),sha});
  }
  await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});
  const card=page.locator('[data-collection-id]').first();await expect(card).toBeVisible();
  // A click is replayed through hydration; verify the visible action before
  // sending a key event to a freshly server-rendered collection card.
  await card.getByRole('button',{name:/More options/}).click();await expect(page.getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);
  // Native scroll events arrive after layout updates. Bringing a trigger into
  // view immediately before opening its menu must not dismiss the new menu.
  await card.getByRole('button',{name:/More options/}).evaluate(button=>{
   document.querySelector('#music-main').scrollTop+=1;
   button.click();
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({path:`${output}/${width}-collection-menu.png`,animations:'disabled'});
  await page.locator('#music-main').evaluate(element=>{element.scrollTop+=70;});
  await expect(page.getByRole('menu')).toHaveCount(0);
  const link=card.locator('a').first();await link.focus();await page.keyboard.press('Shift+F10');
  let menu=page.getByRole('menu');await expect(menu).toBeVisible();
  await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'Save songs on this device'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(link).toBeFocused();
  await card.click({button:'right'});await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  if(width<700){
   const point=await link.boundingBox(),x=point.x+point.width/2,y=point.y+point.height/2;
   await link.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:11,isPrimary:true,button:0,clientX:x,clientY:y});
   await page.waitForTimeout(560);await link.dispatchEvent('pointerup',{pointerType:'touch',pointerId:11,isPrimary:true,button:0,clientX:x,clientY:y});
   await expect(page.getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');
   await link.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:12,isPrimary:true,button:0,clientX:x,clientY:y});
   await link.dispatchEvent('pointermove',{pointerType:'touch',pointerId:12,isPrimary:true,button:0,clientX:x,clientY:y+30});
   await page.waitForTimeout(560);await link.dispatchEvent('pointerup',{pointerType:'touch',pointerId:12,isPrimary:true,button:0,clientX:x,clientY:y+30});
   await expect(page.getByRole('menu')).toHaveCount(0);
  }
  report.checks.push(`${width}px collection cards: queued pre-open scroll retained, later page scrolling dismisses, Shift+F10, menu navigation, Escape/focus restore, right-click${width<700?', long press, movement cancels hold':''}`);
  await context.close();
 }
 assert.deepEqual(report.errors,[],'No runtime page errors');
 await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
