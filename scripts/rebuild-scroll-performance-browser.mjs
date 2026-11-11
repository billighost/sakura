/** Actual routes and assets, with synthetic account/catalog/audio data. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium, webkit, expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3091';
const engine=process.env.SAKURA_PERFORMANCE_BROWSER||'chromium';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic session signing configuration is required.');
const account={id:'90000000-0000-4000-8000-000000000086',username:'Scroll performance fixture'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const worlds=['sakura','japan','ocean','cosmos','china','jungle','glass','disco','india','korea'];
const tracks=Array.from({length:80},(_,index)=>{
  const id=`80000000-0000-4000-8000-${String(index+8600).padStart(12,'0')}`;
  const metadata={title:`Performance song ${index+1}${index%6===0?' with a longer title to check line wrapping':''}`,artists:['Synthetic artist'],durationMs:90000,
    coverUrl:`/bloom/covers/${worlds[index%worlds.length]}-light-480.webp`,albumTitle:'Synthetic performance album'};
  return {id,recordingId:id,...metadata,metadata,reference:{provider:'deezer',id:String(8600+index)},references:[{provider:'deezer',id:String(8600+index)}]};
});
const rate=8000,samples=rate*90,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i/rate*220*Math.PI*2)*200),44+i*2);
const browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
const output='.local/scroll-performance';await fs.mkdir(output,{recursive:true});
const report={engine,base,scope:'Actual Home route with 80 synthetic songs, intercepted APIs/audio and real local cover assets.',checks:[],errors:[]};

try{
  for(const width of [390,320,1440]){
    const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,isMobile:width<650,hasTouch:width<650,serviceWorkers:'block',reducedMotion:'no-preference'});
    await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
    await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
    const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(error.message));
    await page.route('**/fixture-scroll-performance.wav',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
    await page.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname;
      if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
      if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',privateSession:true,onboarded:true,openingAnimation:0,reducedMotion:false,volume:.1}});
      if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{}}});
      if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
      if(path==='/api/v2/feed/hero')return route.fulfill({json:{item:{track:tracks[0],reason:'Synthetic performance recommendation.',lane:'similar'},generatedAt:new Date().toISOString()}});
      if(path==='/api/v2/feed'){
        const offset=Number(url.searchParams.get('cursor'))||0;
        return route.fulfill({json:{items:tracks.slice(offset,offset+12).map(track=>({track,lane:'similar',reason:'A synthetic recommendation for checking scroll stability.'})),sections:[],nextCursor:offset+12<tracks.length?String(offset+12):null,totalCandidates:tracks.length,personalized:true,generatedAt:new Date().toISOString()}});
      }
      if(path==='/api/v2/recordings/resolve'){
        const selected=tracks.find(track=>track.reference.id===request.postDataJSON().reference?.id)||tracks[0];
        return route.fulfill({json:{status:'resolved',recording:selected,playback:{url:base+'/fixture-scroll-performance.wav',assetId:'performance-tone',sizeBytes:wav.length}}});
      }
      return route.fulfill({json:{items:[],recordings:[],playlists:[],mixes:[],albums:[]}});
    });
    await page.goto(base+'/home',{waitUntil:'domcontentloaded',timeout:90000});
    const hero=page.locator('[data-hero-music]'),stage=page.locator('#music-main'),chapters=page.locator('[class*="songChapters"]>[data-motion-region]');
    await expect(hero).toHaveAttribute('data-motion-active','true');
    const hasAudio=engine!=='webkit'&&await page.evaluate(()=>typeof AudioContext==='function');
    if(hasAudio){await hero.locator('button[aria-label^="Play "]').click();await expect(hero.locator('button[aria-label^="Pause "]')).toBeVisible();}
    const record=hero.locator('[class*="record"]');
    if(hasAudio)await expect(record).toHaveAttribute('data-playing','true');
    await page.waitForFunction(()=>document.querySelectorAll('section[aria-label$="song feed"] [data-song-id]').length>=12);
    await chapters.first().evaluate(node=>{window.__firstChapter=node;window.__firstSongs=[...node.querySelectorAll('[data-song-id]')];});
    for(let pass=0;pass<8;pass++){
      await stage.evaluate(node=>node.scrollTop=node.scrollHeight);
      const expected=Math.min(80,(pass+2)*12);
      await expect.poll(()=>page.locator('section[aria-label$="song feed"] [data-song-id]').count()).toBeGreaterThanOrEqual(expected);
    }
    assert.equal(await page.locator('section[aria-label$="song feed"] [data-song-id]').count(),80);
    await expect(hero).toHaveAttribute('data-motion-active','false');
    assert.equal(await record.evaluate(node=>getComputedStyle(node).animationPlayState),'paused');
    if(hasAudio){
      const before=await record.evaluate(node=>node.getAnimations()[0]?.currentTime);
      await page.waitForTimeout(350);
      const after=await record.evaluate(node=>node.getAnimations()[0]?.currentTime);
      assert.ok(Math.abs(after-before)<2,'Offscreen vinyl animation stops advancing.');
    }
    await stage.evaluate(node=>node.scrollTop=0);await expect(hero).toHaveAttribute('data-motion-active','true');
    await page.evaluate(()=>{
      window.__motionHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__motionHidden});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(hero).toHaveAttribute('data-motion-active','false');
    assert.equal(await record.evaluate(node=>getComputedStyle(node).animationPlayState),'paused');
    await page.evaluate(()=>{window.__motionHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    await expect(hero).toHaveAttribute('data-motion-active','true');
    const scrolling=await stage.evaluate(async node=>{
      const adjustments=[];
      for(let pass=0;pass<2;pass++){
        node.scrollTop=0;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        for(let step=0;step<200;step++){
          const target=Math.min(node.scrollTop+180,node.scrollHeight-node.clientHeight-250);
          if(target<=node.scrollTop)break;
          node.scrollTop=target;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          adjustments.push(node.scrollTop-target);
        }
      }
      const first=document.querySelector('[class*="songChapters"]>[data-motion-region]');
      return {maxScrollAdjustment:Math.max(0,...adjustments.map(Math.abs)),sameChapter:first===window.__firstChapter,
        sameSongs:window.__firstSongs.every((song,index)=>first.querySelectorAll('[data-song-id]')[index]===song),
        fit:node.scrollWidth<=node.clientWidth+1,
        chapterHeights:[...document.querySelectorAll('[class*="songChapters"]>[data-motion-region]')].map(chapter=>Math.round(chapter.getBoundingClientRect().height))};
    });
    assert.equal(scrolling.sameChapter,true);assert.equal(scrolling.sameSongs,true);assert.equal(scrolling.fit,true);
    assert.ok(scrolling.maxScrollAdjustment<=2,'Scrolling cannot skip to a different offset: '+JSON.stringify(scrolling));
    report.checks.push({width,songs:80,offscreenPaused:true,hiddenPaused:true,resumed:true,audio:hasAudio,...scrolling});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  await fs.writeFile(`${output}/${engine}-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
