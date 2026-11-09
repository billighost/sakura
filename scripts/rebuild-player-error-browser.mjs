/** Actual player recovery cards over page content, using synthetic account APIs only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect as playwrightExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3015';
const expect=playwrightExpect.configure({timeout:45000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000093',username:'Recovery fixture',email:'recovery@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const track={id:'80000000-0000-4000-8000-000000000093',title:'A moment to reconnect',artists:['The Garden Ensemble'],durationMs:30000,coverUrl:null,albumTitle:'Recovery fixture',versionLabel:'Original recording',reference:{provider:'deezer',id:'93'},references:[{provider:'deezer',id:'93'}]};
const rate=8000,samples=rate*30,audio=Buffer.alloc(44+samples*2);
audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(rate,24);audio.writeUInt32LE(rate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)audio.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*400),44+i*2);
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checkedAt:new Date().toISOString(),scope:'Synthetic authenticated APIs and real WAV audio; no server database mutations',checks:[],pageErrors:[],unexpectedRequests:[]};
await fs.mkdir('.local',{recursive:true});
try{
 for(const viewport of [{width:1440,height:460},{width:390,height:568},{width:320,height:360}])for(const theme of ['light','dark']){
  let unavailable=true,session=null;
  const context=await browser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
  await context.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
   if(path==='/api/v2/settings')return route.fulfill({json:{theme,audioQuality:'data-saver',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],volume:.3,shuffle:false,repeat:'off'}});
   if(path==='/api/v2/home')return route.fulfill({json:{featured:[track],mixes:[],recent:[]}});
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:[track],playlists:[]}});
   if(path==='/api/v2/listening-session'){
    if(method==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
    return route.fulfill({json:{session,serverTime:Date.now()}});
   }
   if(path==='/api/v2/recordings/resolve')return unavailable?route.fulfill({status:502,json:{reason:'backend-unavailable'}}):route.fulfill({json:{status:'resolved',recording:{recordingId:track.id,metadata:{title:track.title,artists:track.artists,durationMs:track.durationMs},references:track.references},playback:{url:'/fixture-recovery.wav',assetId:'recovery-fixture',sizeBytes:audio.length}}});
   if(path==='/api/v2/lyrics')return route.fulfill({json:{lines:[],timing:'unsynced',status:'unavailable'}});
   if(!['GET','HEAD'].includes(method))report.unexpectedRequests.push({path,method});
   return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
  });
  await context.route('**/fixture-recovery.wav',route=>route.fulfill({body:audio,contentType:'audio/wav'}));
  const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('#music-main h1').first().waitFor();
  try{await page.getByRole('button',{name:'Play '+track.title,exact:true}).first().click();}catch(error){await page.screenshot({path:'.local/rebuild-player-error-failure.png'});console.error(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,1500)}));throw error;}
  const notice=page.locator('footer [role="alert"]');
  await expect(notice).toBeVisible();
  async function inspect(room){
   const dimensions=await notice.evaluate(element=>{
    const container=element.parentElement,rect=container.getBoundingClientRect();
    const samples=[];
    for(const copy of element.querySelectorAll('h3,p,button,a')){
     const box=copy.getBoundingClientRect(),x=(box.left+box.right)/2,y=(box.top+box.bottom)/2;
     if(y<rect.top||y>rect.bottom||x<0||x>innerWidth)continue;
     const above=document.elementFromPoint(x,y);samples.push({tag:copy.tagName,visible:!!above&&element.contains(above)});
    }
    const hero=document.querySelector('[class*="homeHero"]'),heroRect=hero?.getBoundingClientRect();
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:container.clientWidth,scrollWidth:container.scrollWidth,samples,heroOverlap:!!heroRect&&rect.left<heroRect.right&&rect.right>heroRect.left&&rect.top<heroRect.bottom&&rect.bottom>heroRect.top,theme:document.documentElement.dataset.inkTheme};
   });
   assert.ok(dimensions.left>=0&&dimensions.right<=viewport.width,room+' notice fits horizontally');
   assert.ok(dimensions.top>=0&&dimensions.bottom<=viewport.height,room+' notice fits vertically');
   assert.ok(dimensions.scrollWidth<=dimensions.width+1,room+' notice has no horizontal overflow');
   assert.ok(dimensions.samples.length>0&&dimensions.samples.every(sample=>sample.visible),room+' text and controls paint above page content');
   assert.equal(dimensions.theme,theme);
   report.checks.push({room,viewport,theme,...dimensions});
   await page.screenshot({path:`.local/rebuild-player-error-${room}-${viewport.width}-${theme}.png`});
  }
  await inspect('library');
  const homeLink=page.getByRole('link',{name:'Home',exact:true}).filter({visible:true}).first();
  await homeLink.click();await expect(page).toHaveURL(/\/home$/);await page.locator('#music-main h1').first().waitFor();
  await inspect('home');
  const retry=notice.getByRole('button',{name:'Retry song',exact:true});
  await retry.scrollIntoViewIfNeeded();
  assert.equal(await retry.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2));}),true,'Retry remains accessible in short viewports');
  unavailable=false;await retry.click();
  await expect(notice).toHaveCount(0);await expect(page.getByRole('button',{name:'Pause',exact:true}).filter({visible:true}).first()).toBeVisible();
  await context.close();
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.unexpectedRequests,[]);
 await fs.writeFile('.local/rebuild-player-error-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.checks.length,viewports:3,themes:2,rooms:['home','library'],textAbovePage:true,retryAccessible:true,pageErrors:0,serverDatabaseMutations:0}));
}finally{await browser.close();}
