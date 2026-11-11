/** Real Next pages with intercepted synthetic account/music data and real cover files. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit,expect as baseExpect} from '@playwright/test';
import 'dotenv/config';
import {encode} from 'next-auth/jwt';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3012',baseline=process.env.SAKURA_BLOOM_PREVIEW_BASELINE==='1';
const engine=process.env.SAKURA_BLOOM_BROWSER||'chromium',expect=baseExpect.configure({timeout:20000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Synthetic auth signing configuration is required.');
const account={id:'90000000-0000-4000-8000-000000000095',username:'Bloom scroll fixture'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const dates={period:'monthly',periodStart:'2026-10-01T00:00:00+01:00',periodEnd:'2026-11-01T00:00:00+01:00',publishAt:'2026-11-01T00:00:00+01:00',expiresAt:'2099-11-24T00:00:00+01:00',timeZone:'Africa/Lagos',chapterCount:1};
const items=[{id:'monthly-2026-10',...dates,status:'available',worldId:'sakura'},{id:'monthly-2026-11',...dates,publishAt:'2099-12-01T00:00:00+01:00',status:'locked',worldId:'china'}];
const track={id:'80000000-0000-4000-8000-000000000095',recordingId:'80000000-0000-4000-8000-000000000095',title:'A continuous listening moment',artists:['Synthetic fixture'],durationMs:90000,metadata:{title:'A continuous listening moment',artists:['Synthetic fixture'],durationMs:90000},reference:{provider:'deezer',id:'95'},references:[{provider:'deezer',id:'95'}]};
const rate=8000,wav=Buffer.alloc(44+rate*90*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*90;i++)wav.writeInt16LE(Math.round(Math.sin(i/rate*220*Math.PI*2)*200),44+i*2);
const output='.local/bloom-cover-scroll';await fs.mkdir(output,{recursive:true});
const report={baseline,engine,base,scope:'Actual /bloom, /home, /discover and /profile pages; synthetic account/audio/API data, real authored cover assets.',checks:[],errors:[]};
const browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
try{
 for(const width of baseline?[390]:[1280,390]){
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'no-preference'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');});
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
  let bloomLoads=0,revealed=false,settings={theme:'light',privateSession:true,onboarded:true,openingAnimation:0,reducedMotion:false,bloomPerformance:'5',volume:.2};
  const recap=()=>({...items[0],summary:{audibleMs:3600000,playCount:20,recordingCount:1,activeDays:4},completed:false,chapters:[{id:'cover-scroll-chapter',title:'A listening moment',kind:'time',prompt:'The time your songs carried.',revealed,stat:revealed?{label:'Listening time',value:1234,unit:'minutes'}:null,relatedRecording:null}]});
  const coverRequests=[];page.on('request',request=>{if(request.url().includes('/bloom/covers/'))coverRequests.push(request.url());});
  await page.route('**/fixture-bloom-scroll.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
   if(path==='/api/v2/settings'){if(request.method()==='PATCH')settings={...settings,...request.postDataJSON()};return route.fulfill({json:settings});}
   if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
   if(path==='/api/v2/bloom'){bloomLoads++;return route.fulfill({json:{items,schedule:{timeZone:'Africa/Lagos'}}});}
   if(path==='/api/v2/bloom/archive')return route.fulfill({json:{items:[]}});
   if(path==='/api/v2/bloom/monthly-2026-10/prepare')return route.fulfill({json:{story:recap(),chapters:[{...recap().chapters[0],stat:{label:'Listening time',value:1234,unit:'minutes'}}]}});
   if(path==='/api/v2/bloom/monthly-2026-10/reveal'){assert.equal(request.postDataJSON().chapterId,'cover-scroll-chapter');revealed=true;return route.fulfill({json:recap()});}
   if(path==='/api/v2/bloom/monthly-2026-10')return route.fulfill({json:recap()});
   if(path==='/api/v2/home')return route.fulfill({json:{featured:[track],mixes:[],recent:[]}});
   if(path==='/api/v2/mixes')return route.fulfill({json:{mixes:[]}});
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:[],playlists:[]}});
   if(path==='/api/v2/history')return route.fulfill({json:{accepted:true}});
   if(path==='/api/v2/recordings/resolve')return route.fulfill({json:{status:'resolved',recording:track,playback:{url:base+'/fixture-bloom-scroll.wav',assetId:'bloom-scroll-tone',sizeBytes:wav.length}}});
   return route.fulfill({json:{}});
  });
  await page.goto(base+'/home',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button',{name:'Find my soundtrack',exact:true}).waitFor();
  const audioSupported=engine!=='webkit'||await page.evaluate(()=>typeof AudioContext==='function');
  if(audioSupported){await page.getByRole('button',{name:'Find my soundtrack',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).first().waitFor();}
  else report.checks.push({width,surface:'audio',skipped:'Windows WebKit lacks Web Audio; gallery DOM and image scrolling are verified independently.'});
  await page.getByRole('link',{name:/^Your listening worlds/}).click();
  await page.getByRole('heading',{name:'Ten ways to remember.'}).waitFor();
  const selector=baseline?'[class*="bloomPage"] [class*="cardArt"]':'[class*="bloomPage"] [data-bloom-cover]';
  if(!baseline){await expect(page.locator(selector+':visible')).toHaveCount(12);await page.waitForFunction(selector=>[...document.querySelectorAll(selector+' img')].filter(image=>image.getClientRects().length).every(image=>image.complete&&image.naturalWidth>0),selector);}
  await page.evaluate(selector=>{
   const covers=[...document.querySelectorAll(selector)].filter(node=>node.getClientRects().length);window.__coverNodes=covers;window.__coverChildren=covers.map(node=>node.firstElementChild);
   window.__coverMutationCount=0;window.__coverObserver=new MutationObserver(records=>{window.__coverMutationCount+=records.filter(record=>record.type==='childList'||record.attributeName==='src'||record.attributeName==='srcset').length;});
   for(const cover of covers)window.__coverObserver.observe(cover,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset']});
  },selector);
  const requestCount=coverRequests.length;
  for(let pass=0;pass<3;pass++){
   await page.evaluate(async()=>{const stage=document.querySelector('#music-main');for(let y=0;y<stage.scrollHeight;y+=300){stage.scrollTop=y;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}for(let y=stage.scrollHeight;y>=0;y-=300){stage.scrollTop=y;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}});
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>bloomLoads).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  const stability=await page.evaluate(selector=>{const current=[...document.querySelectorAll(selector)].filter(node=>node.getClientRects().length);return {count:current.length,mutations:window.__coverMutationCount,sameNodes:window.__coverNodes.every((node,index)=>current[index]===node),sameChildren:window.__coverNodes.every((node,index)=>node.firstElementChild===window.__coverChildren[index]),worldStages:document.querySelectorAll('[data-bloom-cover] [data-bloom-world]').length,fit:document.querySelector('#music-main').scrollWidth<=document.querySelector('#music-main').clientWidth+1};},selector);
  if(!baseline){assert.equal(stability.mutations,0);assert.equal(stability.sameNodes,true);assert.equal(stability.sameChildren,true);assert.equal(stability.worldStages,0);assert.equal(stability.fit,true);assert.equal(coverRequests.length,requestCount);if(audioSupported)await expect(page.getByRole('button',{name:'Pause',exact:true}).first()).toBeVisible();}
  report.checks.push({width,surface:'gallery',stability,bloomLoads,coverRequests:coverRequests.length,requestsDuringScroll:coverRequests.length-requestCount});
  await page.screenshot({path:`${output}/${baseline?'before':'after'}-gallery-${engine}-${width}.png`});
  if(!baseline){
   for(const surface of ['home','discover','profile']){
    await page.goto(base+'/'+surface,{waitUntil:'domcontentloaded',timeout:90000});const cover=page.locator('[data-bloom-cover]:visible');await expect(cover).toHaveCount(1);await page.waitForFunction(()=>[...document.querySelectorAll('[data-bloom-cover] img')].filter(image=>image.getClientRects().length).every(image=>image.complete&&image.naturalWidth>0));
    await cover.evaluate(node=>{window.__shelfCover=node;window.__shelfImage=node.firstElementChild;window.__shelfMutations=0;window.__shelfObserver=new MutationObserver(records=>window.__shelfMutations+=records.length);window.__shelfObserver.observe(node,{childList:true,subtree:true});});
    await page.evaluate(async()=>{const stage=document.querySelector('#music-main');for(let i=0;i<4;i++){stage.scrollTop=stage.scrollHeight;await new Promise(resolve=>requestAnimationFrame(resolve));stage.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(resolve));}window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(400);
    const shelf=await cover.evaluate(node=>({sameNode:node===window.__shelfCover,sameImage:node.firstElementChild===window.__shelfImage,mutations:window.__shelfMutations,worldStages:node.querySelectorAll('[data-bloom-world]').length}));
    assert.deepEqual(shelf,{sameNode:true,sameImage:true,mutations:0,worldStages:0});report.checks.push({width,surface,stability:shelf});
   }
   await page.goto(base+'/bloom',{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('heading',{name:'Ten ways to remember.'}).waitFor();
   await page.evaluate(async()=>{await fetch('/api/v2/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'dark'})});window.dispatchEvent(new Event('focus'));});
   await expect.poll(()=>page.locator('[class*="bloomPage"] [data-bloom-cover][data-theme="dark"]:visible').count()).toBe(12);
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-bloom-cover] img')].every(image=>image.complete&&image.naturalWidth>0));
   assert.ok(await page.locator('[data-bloom-cover] img').evaluateAll(images=>images.every(image=>image.currentSrc.includes('-dark-'))));report.checks.push({width,surface:'gallery',darkAssets:true});
   assert.equal(await page.locator('[data-bloom-world]').count(),0,'Gallery does not mount cinematic worlds.');
   await page.screenshot({path:`${output}/after-gallery-dark-${engine}-${width}.png`});
   await page.getByRole('link',{name:'Open this Bloom',exact:true}).click();
   const dialog=page.locator('dialog[open]');await dialog.locator('[data-bloom-world="sakura"]').waitFor();
   assert.ok(await dialog.locator('svg').count()>3,'Opening the detail still mounts the rich authored world.');
   await dialog.getByRole('button',{name:'Open my Bloom',exact:true}).click();await expect.poll(()=>revealed).toBe(true);await expect(dialog.getByText('Listening time',{exact:true})).toBeVisible();
   await dialog.getByRole('button',{name:'Close Sakura Bloom',exact:true}).click();await expect(page.getByRole('heading',{name:'Ten ways to remember.'})).toBeVisible();await expect(page.locator('[class*="bloomPage"] [data-bloom-cover]:visible')).toHaveCount(12);
   report.checks.push({width,surface:'detail',richWorld:true,reveal:true,closeReturnsToStaticGallery:true});
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);await fs.writeFile(`${output}/${baseline?'before':'after'}-${engine}-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
