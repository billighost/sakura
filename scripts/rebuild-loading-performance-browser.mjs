/** Measure production loading with actual bundles and signed synthetic API data. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3092';
const baseline=process.env.SAKURA_PERFORMANCE_BASELINE_URL;
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic session signing configuration is required.');
const account={id:'90000000-0000-4000-8000-000000000087',username:'Loading performance fixture'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const tracks=Array.from({length:12},(_,index)=>{
  const id=`80000000-0000-4000-8000-${String(index+8700).padStart(12,'0')}`;
  const metadata={title:`Loading fixture song ${index+1}`,artists:['Synthetic artist'],durationMs:90000,coverUrl:'/bloom/covers/sakura-light-480.webp',albumTitle:'Fixture album'};
  return {id,recordingId:id,...metadata,metadata,reference:{provider:'deezer',id:String(index+8700)},references:[{provider:'deezer',id:String(index+8700)}]};
});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Cold 390px/DPR2 production Home loads; actual application bundles, covers and fonts; intercepted synthetic account/catalog APIs; service workers blocked.',runs:[],errors:[]};
const output='.local/loading-performance';await fs.mkdir(output,{recursive:true});
try{
  for(const [label,origin] of [...(baseline?[['before',baseline]]:[]),['after',base]]){
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.addCookies([{name:'authjs.session-token',value:token,url:origin}]);
    await context.addInitScript(()=>{
      sessionStorage.setItem('sakura-ink-opening','1');
      window.__loadingLcp=0;
      new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__loadingLcp=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
    });
    const page=await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>report.errors.push({label,message:error.message}));
    const apiRequests=[];
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname;apiRequests.push(path);
      if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
      if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{}}});
      if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',onboarded:true,privateSession:true,openingAnimation:0,reducedMotion:false}});
      if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
      if(path==='/api/v2/feed/hero')return route.fulfill({json:{item:{track:tracks[0],lane:'similar',reason:'Synthetic loading fixture.'},generatedAt:new Date().toISOString()}});
      if(path==='/api/v2/feed')return route.fulfill({json:{items:tracks.map(track=>({track,lane:'similar',reason:'Synthetic loading fixture.'})),sections:[],nextCursor:null,totalCandidates:12,personalized:true,generatedAt:new Date().toISOString()}});
      return route.fulfill({json:{items:[],recordings:[],playlists:[],mixes:[],albums:[]}});
    });
    if(process.env.SAKURA_PERFORMANCE_CPU_RATE){
      const session=await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.SAKURA_PERFORMANCE_CPU_RATE)});
    }
    await page.goto(origin+'/home',{waitUntil:'domcontentloaded',timeout:90000});
    await expect(page.locator('[data-hero-music] [data-song-id]')).toHaveCount(1);
    await expect(page.locator('section[aria-label$="song feed"] [data-song-id]')).toHaveCount(12);
    const readyMs=await page.evaluate(()=>performance.now());
    await page.waitForTimeout(1500);
    const measurement=await page.evaluate(()=>{
      const resources=performance.getEntriesByType('resource');
      const scripts=resources.filter(entry=>new URL(entry.name).pathname.endsWith('.js'));
      const styles=resources.filter(entry=>new URL(entry.name).pathname.endsWith('.css'));
      const sum=(entries,key)=>entries.reduce((total,entry)=>total+entry[key],0);
      const main=document.querySelector('#music-main');
      return {javascript:{requests:scripts.length,encodedBytes:sum(scripts,'encodedBodySize'),decodedBytes:sum(scripts,'decodedBodySize'),paths:scripts.map(entry=>new URL(entry.name).pathname)},css:{requests:styles.length,encodedBytes:sum(styles,'encodedBodySize'),decodedBytes:sum(styles,'decodedBodySize')},fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,lcpMs:window.__loadingLcp,fit:main.scrollWidth<=main.clientWidth+1};
    });
    assert.equal(measurement.fit,true);
    assert.ok(measurement.javascript.encodedBytes>0,'Real application JS transfer sizes are available.');
    report.runs.push({label,origin,readyMs,...measurement,apiRequests});
    await page.screenshot({path:`${output}/${label}-home.png`});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  if(baseline){
    const [before,after]=report.runs;
    report.javascriptReduction=1-after.javascript.encodedBytes/before.javascript.encodedBytes;
    assert.ok(after.javascript.encodedBytes<before.javascript.encodedBytes,'Home loads less JS after demand splitting.');
  }
  await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,runs:report.runs.map(({javascript,...run})=>({...run,javascript:{...javascript,paths:undefined}}))},null,2));
}finally{await browser.close();}
