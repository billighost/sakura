import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import 'dotenv/config';

// This harness intercepts every application API and must only visit local builds.
const target=new URL(process.env.SAKURA_TEST_URL||'http://127.0.0.1:3100');
assert.ok(['http:','https:'].includes(target.protocol)&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&!target.username&&!target.password&&target.pathname==='/'&&!target.search&&!target.hash,'Use a loopback production server origin for SAKURA_TEST_URL');
const base=target.origin;
const account={id:'97090000-0000-4000-8000-000000000411',username:'Navigation fixture',email:'navigation@example.invalid'};
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',japaneseReading:false,privateSession:false,discovery:.35,artistVariety:.65,repeatTolerance:.45,newReleaseBias:.5,deepCutBias:.35,timeAware:true,learnFromListening:true,reducedMotion:true,openingAnimation:0,bloomPerformance:'auto',seedArtists:[],seedGenres:[],onboarded:true,timeZone:'Africa/Lagos',explicitContent:true,volume:.8,shuffle:false,repeat:'off',previewVolume:.8,previewLoop:true,sleepTimerMinutes:15};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local signing configuration is required');
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const track={recordingId:'97090000-0000-4000-8000-000000000412',metadata:{title:'Prepared production fixture',artists:['Prepared artist'],durationMs:120000},reference:{provider:'deezer',id:'production-fixture'},references:[{provider:'deezer',id:'production-fixture'}],coverUrl:null};
const browser=await chromium.launch({channel:'chrome',headless:true});
const samples=[],errors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 for(let run=0;run<3;run++){
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:1280,height:900}});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(({account,settings})=>{
   sessionStorage.setItem('sakura-ink-opening','1');
   localStorage.setItem('sakura-v2-active-account',account.id);
   localStorage.setItem('sakura-v2-preferences:'+account.id,JSON.stringify({settings,pending:false,savedAt:Date.now()}));
   window.__navigationMetrics={shell:null,feed:null,click:null,ready:null};
   const check=()=>{
    const metric=window.__navigationMetrics,home=document.querySelector('[data-personalized-feed="home"]');
    if(metric.shell===null&&home)metric.shell=performance.now();
    if(metric.feed===null&&home?.textContent.includes('Prepared production fixture'))metric.feed=performance.now();
    if(metric.click!==null&&metric.ready===null){
     const room=document.querySelector('[data-personalized-feed="'+metric.target+'"]');
     if(room?.textContent.includes('Prepared production fixture')&&room.getBoundingClientRect().width>0){
      requestAnimationFrame(()=>{if(metric.ready===null)metric.ready=performance.now()-metric.click;});
     }
    }
   };
   new MutationObserver(check).observe(document,{childList:true,subtree:true,attributes:true});
   document.addEventListener('click',event=>{
    const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;
    if(anchor&&['/home','/discover'].includes(new URL(anchor.href).pathname)){
     const metric=window.__navigationMetrics;metric.target=new URL(anchor.href).pathname.slice(1);metric.click=performance.now();metric.ready=null;requestAnimationFrame(check);
    }
   },true);
  },{account,settings});
  const requests=[];
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),endpoint=url.pathname;
   requests.push({endpoint,query:url.search,method:req.method()});
   if(endpoint==='/api/v2/bootstrap'){await pause(40);return route.fulfill({json:{profile:account}});}
   if(endpoint==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[],topSongs:[]}});
   if(endpoint==='/api/v2/settings')return route.fulfill({json:settings});
   if(endpoint==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[]}});
   if(endpoint==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
   if(endpoint==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});
   if(endpoint==='/api/v2/library')return route.fulfill({json:{recordings:[],playlists:[],nextCursor:null}});
   if(endpoint==='/api/v2/feed'||endpoint==='/api/v2/feed/hero'){
    await pause(250);const item={track,lane:'similar',reason:'Prepared recommendation explanation'};
    return route.fulfill({json:endpoint.endsWith('hero')?{item,refreshAt:Date.now()+600000}:{items:[item],sections:[],nextCursor:null,personalized:true,totalCandidates:1,generatedAt:new Date().toISOString()}});
   }
   if(endpoint==='/api/v2/bloom/shelf')return route.fulfill({json:{blooms:[],entries:[]}});
   return route.fulfill({json:{accepted:true,artists:[],mixes:[],events:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/home',{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.locator('[data-personalized-feed="home"]')).toContainText(track.metadata.title);
  const startup=await page.evaluate(()=>window.__navigationMetrics);
  const profileBeforeInteraction=requests.filter(row=>row.endpoint==='/api/v2/profile').length;
  const discover=page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Discover',exact:true});
  await discover.hover();
  await expect.poll(()=>requests.filter(row=>row.endpoint==='/api/v2/feed'&&row.query.includes('surface=discover')).length).toBeGreaterThan(0);
  await pause(550);
  const beforeDiscover=requests.filter(row=>/^\/api\/v2\/feed/.test(row.endpoint)&&row.query.includes('surface=discover')).length;
  await discover.click();await expect(page.locator('[data-personalized-feed="discover"]')).toContainText(track.metadata.title);
  await expect.poll(()=>page.evaluate(()=>window.__navigationMetrics.ready)).not.toBeNull();
  const firstIntentMs=await page.evaluate(()=>window.__navigationMetrics.ready);
  const afterDiscover=requests.filter(row=>/^\/api\/v2\/feed/.test(row.endpoint)&&row.query.includes('surface=discover')).length;
  assert.equal(afterDiscover,beforeDiscover,'Prefetched discovery must not fetch feed/hero again on click');
  const revisits=[];
  for(const surface of ['home','discover','home','discover']){
   const label=surface==='home'?'Home':'Discover';
   await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:label,exact:true}).click();
   await expect(page.locator('[data-personalized-feed="'+surface+'"]')).toContainText(track.metadata.title);
   await expect.poll(()=>page.evaluate(()=>window.__navigationMetrics.ready)).not.toBeNull();
   revisits.push(await page.evaluate(()=>window.__navigationMetrics.ready));
  }
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('[data-personalized-feed="discover"]')).toContainText(track.metadata.title);
  const warmReloadMs=await page.evaluate(()=>performance.now());
  samples.push({run:run+1,shellMs:startup.shell,firstFeedMs:startup.feed,profileBeforeInteraction,firstIntentMs,revisitsMs:revisits,duplicateDiscoverRequests:afterDiscover-beforeDiscover,warmReloadObservedMs:warmReloadMs,requests});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 const report={checkedAt:new Date().toISOString(),environment:'Local production Next server, headless Chrome, synthetic signed account, intercepted APIs: bootstrap delayed 40 ms and feed/hero delayed 250 ms. Reduced motion and opening disabled. Fresh browser contexts retain only seeded preference settings. No real account writes or live API latency measurements.',samples,errors};
 await fs.mkdir('.local',{recursive:true});
 await fs.writeFile('.local/production-navigation-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,samples:samples.map(sample=>({...sample,requests:undefined}))},null,2));
}finally{await browser.close();}
