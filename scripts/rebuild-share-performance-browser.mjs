/** Shipped ShareDialog on a loopback production build; synthetic media/APIs,
 * stubbed native share, and held native PNG callbacks. Creates no app routes. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect as baseExpect} from '@playwright/test';
import {installPerformanceFixture,localOrigin,performanceCatalog} from './fixtures/performance-browser.mjs';

const base=localOrigin(process.env.SAKURA_TEST_URL||'http://127.0.0.1:3117');
const expect=baseExpect.configure({timeout:20000});
const account={id:'94020000-0000-4000-8000-000000000501',username:'Share fixture',email:'share@example.invalid'};
const catalog=performanceCatalog({count:2,offset:9501,label:'Synthetic share song'});
const report={checkedAt:new Date().toISOString(),scope:'Current production ShareDialog; generated media and intercepted APIs; native share is stubbed, PNG encoding is real with controlled callback delay; no physical share-sheet claim',checks:[],errors:[]};
await mkdir('.local/share-performance-browser',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
let page,heldLink=null,holdLink=false;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
 const fixture=await installPerformanceFixture(context,{origin:base,account,catalog,settings:{reducedMotion:true}});
 // Never let root/public-share Server Components access an account behind the
 // browser API interception. All other requests use the fixture's deny rules.
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  return url.origin===base&&(url.pathname==='/'||url.pathname.startsWith('/s/'))?route.abort('blockedbyclient'):route.fallback();
 });
 await context.route('**/api/v2/library**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:catalog.tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:Object.fromEntries(catalog.tracks.map(track=>[track.id,{liked:true,revision:1}]))}});
  return route.fallback();
 });
 await context.route('**/api/v2/search**',route=>{
  const request=route.request(),url=new URL(request.url()),query=[...url.searchParams.entries()];
  if(request.method()==='GET'&&url.pathname==='/api/v2/search'&&query.length===2&&url.searchParams.get('q')==='Synthetic artist'&&url.searchParams.get('searchVersion')==='2')return route.fulfill({json:{query:'Synthetic artist',tracks:catalog.tracks,artists:[],albums:[],totals:{tracks:catalog.tracks.length,artists:0,albums:0},nextCursors:{tracks:null,artists:null,albums:null}}});
  return route.fallback();
 });
 const links=[];
 await context.route('**/api/v2/shares',async route=>{
  const request=route.request(),payload=request.postDataJSON();
  assert.equal(request.method(),'POST');assert.equal(request.headers()['x-sakura-account'],account.id);
  assert.equal(payload.kind,'track');assert.deepEqual(payload.lines,[]);
  assert.deepEqual(payload.reference,catalog.tracks[0].reference);
  const url=base+'/s/'+String(links.length+1).padStart(16,'a');links.push({payload,url});
  if(holdLink){heldLink={route,url};return;}
  return route.fulfill({json:{url}});
 });
 await context.addInitScript(()=>{
  const probe=window.__shareProbe={pngCalls:0,canvases:[],pendingPng:[],holdPng:false,urls:new Set(),nativeCalls:[]};
  const toBlob=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,...args){
   if(type==='image/png'&&this.width===1080&&(this.height===1080||this.height===1350)){
    probe.pngCalls++;probe.canvases.push(this);
    const held=probe.holdPng;
    return toBlob.call(this,value=>held?probe.pendingPng.push(()=>callback(value)):callback(value),type,...args);
   }
   return toBlob.call(this,callback,type,...args);
  };
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=value=>{const url=create(value);probe.urls.add(url);return url;};
  URL.revokeObjectURL=url=>{probe.urls.delete(url);revoke(url);};
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
  Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
   // Chromium exposes the currently dispatched event here. An awaited
   // preparation callback has already left this trusted click handler.
   probe.nativeCalls.push({clickTask:window.event?.type==='click'&&window.event.isTrusted,activation:navigator.userActivation.isActive,url:data.url||null,files:(data.files||[]).map(file=>({type:file.type,size:file.size,name:file.name})),pngCalls:probe.pngCalls});
   return Promise.resolve();
  }});
 });
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
 const open=async()=>{
  await page.getByRole('button',{name:'More options for '+catalog.tracks[0].title,exact:true}).click();
  await page.getByRole('menuitem',{name:'Share this song',exact:true}).click();
  const dialog=page.locator('dialog[data-dialog-appearance="share"]');
  await expect(dialog).toHaveAttribute('data-dialog-phase','open');return dialog;
 };
 let dialog=await open();
 await expect(dialog.getByRole('button',{name:'Share image',exact:true})).toBeEnabled();
 const initialPng=await page.evaluate(()=>window.__shareProbe.pngCalls);
 await dialog.getByRole('button',{name:'Share image',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__shareProbe.nativeCalls.length)).toBe(1);
 const imageShare=await page.evaluate(()=>window.__shareProbe.nativeCalls[0]);
 assert.equal(imageShare.clickTask,true);assert.equal(imageShare.activation,true);assert.equal(imageShare.pngCalls,initialPng);
 assert.equal(imageShare.files[0].type,'image/png');assert.ok(imageShare.files[0].size>10000);
 report.checks.push('The ready PNG reaches the stubbed native share synchronously in the trusted click task without another raster encode.');
 await dialog.getByRole('button',{name:'Link',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__shareProbe.urls.size)).toBe(0);
 await dialog.getByRole('button',{name:'Prepare share link',exact:true}).click();
 const address=dialog.getByRole('textbox',{name:'Your public share link',exact:true});
 await expect(address).toHaveValue(links[0].url);
 await dialog.getByRole('combobox',{name:'Card size',exact:true}).click();
 await page.getByRole('option',{name:/Square/}).click();
 await expect(dialog.getByRole('combobox',{name:'Card size',exact:true})).toContainText('Square');
 await expect(address).toHaveValue(links[0].url);assert.equal(links.length,1);
 assert.equal(await page.evaluate(()=>window.__shareProbe.pngCalls),initialPng);
 assert.equal(fixture.requests.filter(request=>request.path==='/api/v2/lyrics'||request.path==='/api/v2/readings').length,0);
 await dialog.getByRole('button',{name:'Share link',exact:true}).click();
 const linkShare=await page.evaluate(()=>window.__shareProbe.nativeCalls[1]);
 assert.equal(linkShare.clickTask,true);assert.equal(linkShare.activation,true);assert.equal(linkShare.url,links[0].url);
 report.checks.push('Song links fetch no lyrics/readings; changing raster size retains the ready exact-payload link and starts zero PNG work. Link native share also stays in its click task.');
 // Native PNG cannot be canceled mid-encode. Release its late completion after
 // switching format and prove the canceled canvas cannot become a ready card.
 await page.evaluate(()=>{window.__shareProbe.holdPng=true;});
 await dialog.getByRole('button',{name:'Image',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__shareProbe.pendingPng.length)).toBe(1);
 await dialog.getByRole('button',{name:'Link',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__shareProbe.canvases.every(canvas=>canvas.width===0&&canvas.height===0))).toBe(true);
 await page.evaluate(()=>{window.__shareProbe.holdPng=false;window.__shareProbe.pendingPng.splice(0).forEach(finish=>finish());});
 await expect.poll(()=>page.evaluate(()=>window.__shareProbe.canvases.every(canvas=>canvas.width===0&&canvas.height===0))).toBe(true);
 await expect(address).toHaveValue(links[0].url);
 assert.equal(await page.evaluate(()=>window.__shareProbe.urls.size),0);
 report.checks.push('Switching to Link while real native PNG completion is held promptly retires its canvas before the callback; the late callback publishes no preview or object URL and preserves the ready link.');
 // Paper belongs to link identity. Closing a held request and delivering its
 // obsolete response must leave a new dialog unprepared.
 await dialog.getByRole('button',{name:'Night ink',exact:true}).click();
 await expect(address).toHaveCount(0);holdLink=true;
 await dialog.getByRole('button',{name:'Prepare share link',exact:true}).click();
 await expect.poll(()=>heldLink!==null).toBe(true);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 await heldLink.route.fulfill({json:{url:heldLink.url}}).catch(()=>{});heldLink=null;holdLink=false;
 dialog=await open();await expect(dialog.getByRole('button',{name:'Share image',exact:true})).toBeEnabled();
 await dialog.getByRole('button',{name:'Link',exact:true}).click();
 await expect(dialog.getByRole('textbox',{name:'Your public share link',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Prepare share link',exact:true}).click();
 await expect(dialog.getByRole('textbox',{name:'Your public share link',exact:true})).toHaveValue(links[2].url);
 assert.equal(links.length,3);assert.equal(links[1].payload.colorMode,'dark');assert.equal(links[2].payload.colorMode,'light');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.__shareProbe.urls.size)).toBe(0);
 report.checks.push('Paper changes invalidate the prior link. Closing aborts a held link; a late response cannot prepare a reopened dialog, which obtains its own light-paper payload.');
 report.nativeShares=await page.evaluate(()=>window.__shareProbe.nativeCalls);
 report.raster=await page.evaluate(()=>({pngCalls:window.__shareProbe.pngCalls,remainingUrls:window.__shareProbe.urls.size,allCanvasesReleased:window.__shareProbe.canvases.every(canvas=>canvas.width===0&&canvas.height===0)}));
 report.requests={links,api:fixture.requests,unexpected:fixture.unexpected};
 assert.equal(report.raster.allCanvasesReleased,true);assert.deepEqual(fixture.unexpected,[]);assert.deepEqual(report.errors,[]);
 await writeFile('.local/share-performance-browser/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
 report.failure=String(error);if(page)await page.screenshot({path:'.local/share-performance-browser/failure.png'}).catch(()=>{});
 await writeFile('.local/share-performance-browser/report.json',JSON.stringify(report,null,2)+'\n');throw error;
}finally{
 await heldLink?.route.abort().catch(()=>{});await browser.close();
}
