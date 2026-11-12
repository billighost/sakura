/** Exercise the compiled dialog CSS: prefix rewriting can discard source declarations. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const account={id:'90000000-0000-4000-8000-000000000226',username:'Modal review',email:'modal-review@example.invalid'};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic auth signing configuration is required');
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const track={id:'80000000-0000-4000-8000-000000000226',title:'A little room',artists:['Garden voices'],albumTitle:'Quiet hours',albumReference:{provider:'deezer',id:'701'},artistId:null,albumId:null,durationMs:180000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:'226'},references:[{provider:'deezer',id:'226'}]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Compiled player modal, synthetic account APIs; no database mutations',checks:[],variants:[],pageErrors:[]};
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:width>700?1000:844},hasTouch:true,serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account}});
   if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',openingAnimation:0,reducedMotion:false,onboarded:true,privateSession:true,seedArtists:[],seedGenres:[],audioTechnology:'none',volume:.8}});
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:[track],playlists:[]}});
   if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   return route.fulfill({json:{items:[],recordings:[],feedback:[],tasteEvidence:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(`${width}px: ${error.message}`));
  await page.goto(base+'/library',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Play A little room',exact:true}).click();
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveAttribute('data-dialog-phase','open');
  await dialog.evaluate(element=>{
   window.sakuraBackdropSamples=[];
   const sample=()=>{const style=getComputedStyle(element,'::backdrop');window.sakuraBackdropSamples.push({phase:element.dataset.dialogPhase,open:element.open,blur:style.backdropFilter,animation:style.animationName});};
   const observer=new MutationObserver(()=>{if(element.dataset.dialogPhase==='closing'){sample();requestAnimationFrame(()=>{sample();requestAnimationFrame(sample);});observer.disconnect();}});
   observer.observe(element,{attributes:true,attributeFilter:['data-dialog-phase']});
  });
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  const samples=await page.evaluate(()=>window.sakuraBackdropSamples);
  assert.ok(samples.length>=1,'Dismissal was observed');
  assert.ok(samples.filter(sample=>sample.open).every(sample=>sample.blur==='none'),`${width}px clears blur from the first closing frame: ${JSON.stringify(samples)}`);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Closing restores page scrolling');
  report.variants.push({width,samples});
  report.checks.push(`${width}px modal removes backdrop blur immediately and restores scrolling`);
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await expect(dialog).toHaveAttribute('data-dialog-phase','open');
  await dialog.locator('[data-album-link]').tap();
  await expect.poll(()=>new URL(page.url()).pathname,{timeout:30000}).toBe('/album/deezer%3A701');await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'','Album navigation restores page scrolling');
  report.checks.push(`${width}px album touch navigation closes player and restores scrolling`);
  await context.close();
 }
 assert.deepEqual(report.pageErrors,[]);
 await fs.mkdir('.local/modal-backdrop-review',{recursive:true});
 await fs.writeFile('.local/modal-backdrop-review/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
