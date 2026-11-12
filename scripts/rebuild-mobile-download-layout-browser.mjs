/** Production components with synthetic media and account APIs; no database writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000225',username:'Layout fixture',email:'layout@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const bytes=Buffer.alloc(1024*1024,0),sha=createHash('sha256').update(bytes).digest('hex');
const titles=['A long song title that still has room to breathe','夜のしおり — 月明かりの物語','Garden voices (Evening arrangement)','A chorus for the way home'];
const tracks=titles.map((title,i)=>({id:`80000000-0000-4000-8000-${String(225+i).padStart(12,'0')}`,title,artists:[i===1?'灯りと庭':'The Garden Ensemble'],artistId:null,albumId:null,albumReference:{provider:'deezer',id:String(700+i)},albumTitle:i===1?'月明かりの庭に咲く、静かな花たち':'The very beautiful album from the long quiet evenings',durationMs:180000,coverUrl:'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${['#a77986','#31524a','#b29b70','#77866e'][i]}"/><circle cx="60" cy="35" r="18" fill="#f4ecd7"/><path d="M0 90Q25 60 55 82T100 65V100H0" fill="#213f37"/></svg>`),versionLabel:i===2?'Evening arrangement':'Original recording',reference:{provider:'deezer',id:String(225+i)},references:[{provider:'deezer',id:String(225+i)}],readyPlayback:{kind:'stream',assetId:`81000000-0000-4000-8000-${String(225+i).padStart(12,'0')}`,sizeBytes:bytes.length,sha256:sha,mimeType:'audio/wav',durationMs:180000,url:`/api/v2/recordings/80000000-0000-4000-8000-${String(225+i).padStart(12,'0')}/audio`}}));
const settings={theme:'light',audioTechnology:'none',audioQuality:'data-saver',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],volume:.8,shuffle:false,repeat:'off'};
const report={checks:[],screenshots:[],pageErrors:[],scope:'Synthetic account, browser IndexedDB only; actual collection and download components'};
const browser=await chromium.launch({channel:'chrome',headless:true});
await fs.mkdir('.local/mobile-download-layout',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account}});
  if(path==='/api/v2/settings'){if(request.method()==='PATCH')Object.assign(settings,request.postDataJSON());return route.fulfill({json:settings});}
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,playlists:[]}});
  if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
  if(path==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[]}});
  if(path.endsWith('/audio')){
   await new Promise(resolve=>setTimeout(resolve,15000));
   const match=request.headers().range?.match(/bytes=(\d+)-(\d*)/),start=Number(match?.[1]||0),end=match?.[2]?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;
   return route.fulfill({status:match?206:200,body:bytes.subarray(start,end+1),contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})}}).catch(()=>{});
  }
  if(path==='/api/v2/recordings/resolve'){const input=request.postDataJSON(),track=tracks.find(item=>item.reference.id===input.reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs}},playback:track.readyPlayback}});}
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  return route.fulfill({json:{items:[],recordings:[]}});
 });
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-track-layout]').waitFor();
 await page.evaluate(async({accountId,tracks,sha})=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('entries');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries');
   tracks.forEach((track,i)=>{store.put({version:1,recordingId:track.id,track,status:['paused','prepared','failed','queued'][i],mode:i===1?'prefix':'full',requested:i!==1,priority:100,chunkBytes:256*1024,createdAt:Date.now(),updatedAt:Date.now(),fingerprint:{assetId:track.readyPlayback.assetId,sizeBytes:1024*1024,sha256:sha},error:i===2?'This save needs another try. Your saved parts are still here.':undefined},'account:'+accountId+':download:'+track.id);store.put({offset:0,blob:new Blob([new Uint8Array(256*1024)],{type:'audio/wav'}),sha256:sha},'account:'+accountId+':chunk:'+track.id+':0');});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
 },{accountId:account.id,tracks,sha});
 await page.goto(base+'/library/downloaded',{waitUntil:'domcontentloaded'});
 await page.getByRole('tab',{name:/^Activity/}).click();
 await expect(page.locator('[data-download-kind]')).toHaveCount(4);
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:width>700?1000:844});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  const bounds=await page.locator('#download-activity').evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth,jobs:[...element.querySelectorAll('[data-download-kind]')].map(row=>({width:row.clientWidth,scroll:row.scrollWidth})),page:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(bounds.scroll<=bounds.client+1,`Activity fits ${width}: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.jobs.every(row=>row.scroll<=row.width+1),`Job cards fit ${width}`);
  assert.ok(bounds.page<=bounds.viewport+1,`Page fits ${width}`);
  const pausedJob=page.locator('[data-download-kind]').filter({hasText:tracks[0].title});
  assert.equal(await pausedJob.locator('button').filter({has:page.locator('svg')}).count(),2,'One progress toggle and one cancel, without duplicate flowers');
  const toggle=pausedJob.getByRole('button',{name:'Resume download of '+tracks[0].title,exact:true});
  const size=await toggle.boundingBox();assert.ok(size.width>=44&&size.height>=44,'Progress control has a usable touch target');
  const screenshot=`.local/mobile-download-layout/activity-${width}.png`;await page.locator('[data-download-kind]').first().locator('..').screenshot({path:screenshot});report.screenshots.push(screenshot);
  report.checks.push(`${width}px activity: albums ellipsize, one progress/toggle control, no overflow`);
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Resume download of '+tracks[0].title,exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause download of '+tracks[0].title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause download of '+tracks[0].title,exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume download of '+tracks[0].title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel download of '+tracks[0].title,exact:true}).click();
 await expect(page.locator('[data-download-kind]')).toHaveCount(3);
 report.checks.push('Combined botanical button resumes and pauses the actual durable job; cancel removes it');
 await page.goto(base+'/library',{waitUntil:'domcontentloaded'});
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:width>700?1000:844});
  for(const layout of ['list','compact','cards']){
   await page.getByRole('button',{name:layout[0].toUpperCase()+layout.slice(1)+' layout',exact:true}).click();
   const list=page.locator('[data-track-layout]');await expect(list).toHaveAttribute('data-track-layout',layout);
   const fit=await list.evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth,rows:[...element.querySelectorAll('[data-song-id]')].map(row=>({width:row.clientWidth,scroll:row.scrollWidth}))}));
   assert.ok(fit.scroll<=fit.client+1&&fit.rows.every(row=>row.scroll<=row.width+1),`${width}px ${layout} fits ${JSON.stringify(fit)}`);
   if(layout==='list'&&width<=700){const metadata=list.locator('[data-track-credits]').first();const line=await metadata.evaluate(element=>({height:element.clientHeight,line:parseFloat(getComputedStyle(element).lineHeight)}));assert.ok(line.height<=line.line+1,'Artist and album share one discreet metadata line');}
   const screenshot=`.local/mobile-download-layout/tracks-${width}-${layout}.png`;await list.screenshot({path:screenshot});report.screenshots.push(screenshot);
  }
  report.checks.push(`${width}px track list/compact/cards: minimal linked album metadata and no overflow`);
 }
 assert.deepEqual(report.pageErrors,[]);
 await fs.writeFile('.local/mobile-download-layout/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
