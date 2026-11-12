/** Home campaigns in the real Next UI. Signed synthetic auth; all product APIs
 * are intercepted, so no listener data or real notifications are changed. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';
import {bloomWindow} from '../src/rebuild/bloom/calendar.ts';
import {createBloomExperience} from '../src/rebuild/bloom/experience.ts';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3016';
const coversOnly=process.argv.includes('--covers');
const output=coversOnly?'.local/bloom-cover-fill':'.local/bloom-promotion-review';await fs.mkdir(output,{recursive:true});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Synthetic auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000096',username:'Bloom reminder fixture',email:'bloom-reminder@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const report={scope:'Real Home UI, synthetic account and intercepted APIs, fixed browser dates; no production writes.',checks:[],screenshots:[],layouts:[],errors:[]};
const defaults={theme:'light',audioQuality:'data-saver',audioTechnology:'none',privateSession:true,reducedMotion:true,openingAnimation:0,bloomPerformance:'1',seedArtists:[],seedGenres:[],onboarded:true,timeZone:'Africa/Lagos',explicitContent:true,volume:.5,shuffle:false,repeat:'off',previewVolume:.5,previewLoop:true,sleepTimerMinutes:15};
const track={id:'80000000-0000-4000-8000-000000000096',recordingId:'80000000-0000-4000-8000-000000000096',title:'A little music for tomorrow',artists:['The Bloom Fixtures'],artistId:null,albumId:null,coverUrl:'/bloom/covers/sakura-light-480.webp',durationMs:90000,metadata:{title:'A little music for tomorrow',artists:['The Bloom Fixtures'],durationMs:90000,genres:['Pop'],version:{kinds:['original'],labels:[]}},reference:{provider:'deezer',id:'196'},references:[{provider:'deezer',id:'196'}],genres:['Pop'],playability:'resolvable',version:{kinds:['original'],labels:[]}};
function item(id,now,extra={}){const window=bloomWindow(id,new Date(now),'Africa/Lagos');return {...window,version:4,worldId:'sakura',experience:createBloomExperience(`${account.id}|${id}`,'sakura'),completed:false,...extra};}
const weekly=now=>[item('weekly-2026-11-02',now)];
const annual=now=>[item('weekly-2026-12-28',now),item('monthly-2026-12',now,{worldId:'ocean'}),item('yearly-2026',now,{worldId:'cosmos'})];
const browser=await chromium.launch({channel:'chrome',headless:true});
let debug;
async function view(name,now,getItems,{width=320,dark=false,reduced=true}={}){
 const context=await browser.newContext({viewport:{width,height:width>750?900:844},colorScheme:dark?'dark':'light',reducedMotion:reduced?'reduce':'no-preference',serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 const page=await context.newPage();debug=page;page.setDefaultTimeout(20000);let currentNow=now,shelfReads=0;
 await page.clock.setFixedTime(new Date(now));
 page.on('pageerror',error=>report.errors.push(`${name}: ${error.message}`));
 page.on('console',message=>{if(message.type()==='error'&&/hydration|hydrated|did not match|uncaught|minified react error/i.test(message.text()))report.errors.push(`${name}: ${message.text()}`);});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{...defaults,theme:dark?'dark':'light',reducedMotion:reduced}});
  if(path==='/api/v2/bloom/shelf'){shelfReads++;return route.fulfill({json:{items:getItems(currentNow)}});}
  if(path==='/api/v2/bloom')return route.fulfill({json:{items:getItems(currentNow),schedule:{timeZone:'Africa/Lagos'}}});
  if(path==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[]}});
  if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:new Date(currentNow).getTime()}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:[],playlists:[],nextCursor:null}});
  if(path==='/api/v2/feed/hero')return route.fulfill({json:{item:{track,reason:'A song for your synthetic listening story.',lane:'similar'},generatedAt:currentNow}});
  if(path==='/api/v2/feed')return route.fulfill({json:{items:[{track,reason:'A song for your synthetic listening story.',lane:'similar'}],sections:[],nextCursor:null,totalCandidates:1,personalized:true,generatedAt:currentNow}});
  if(path==='/api/v2/image')return route.fulfill({body:await fs.readFile('public/bloom/covers/sakura-light-480.webp'),contentType:'image/webp'});
  return route.fulfill({json:{items:[],recordings:[],playlists:[],albums:[]}});
 });
 async function load(){await page.goto(`${base}/home`,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('#music-main h1').first().waitFor();await expect.poll(()=>shelfReads).toBeGreaterThan(0);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);}
 const banner=page.locator('[data-bloom-promotion]');
 async function verify(expected){
  await expect(banner).toHaveCount(expected?1:0);
  if(!expected)return;
  await expect(banner).toHaveAttribute('data-bloom-period',expected.period);await expect(banner).toHaveAttribute('data-bloom-promotion',expected.phase);
  if(expected.timing)await expect(banner).toContainText(expected.timing);
  const action=banner.getByRole('link',{name:expected.phase==='anticipation'?"See what's coming":'Check your Sakura Bloom'});await expect(action).toHaveAttribute('href',expected.href);
  await expect(banner.getByRole('button',{name:'Dismiss this Bloom reminder'})).toHaveCount(1);
  const layout=await banner.evaluate(section=>{
   const box=section.getBoundingClientRect(),main=document.querySelector('#music-main'),action=section.querySelector('a').getBoundingClientRect(),dismiss=section.querySelector('button').getBoundingClientRect();
   const heading=section.querySelector('h2'),range=document.createRange();range.selectNodeContents(heading);const text=range.getBoundingClientRect();
   return {width:innerWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,bannerWidth:box.width,textFits:text.left>=box.left-1&&text.right<=box.right+1,actionFits:action.left>=box.left&&action.right<=box.right+1,actionHeight:action.height,dismissWidth:dismiss.width,dismissHeight:dismiss.height,aboveHero:box.top<=document.querySelector('[data-hero-music]')?.getBoundingClientRect().top,animations:section.getAnimations({subtree:true}).filter(value=>value.playState==='running').length};
  });
  assert.ok(layout.documentOverflow<=1&&layout.mainOverflow<=1,`${name} has no horizontal overflow`);assert.ok(layout.textFits&&layout.actionFits,`${name} text and action fit`);assert.ok(layout.actionHeight>=44&&layout.dismissWidth>=44&&layout.dismissHeight>=44,`${name} accessible touch targets`);assert.ok(layout.aboveHero,`${name} campaign is above the hero`);if(reduced)assert.equal(layout.animations,0,`${name} honors reduced motion`);
  report.layouts.push({name,dark,reduced,...layout});
 }
 async function screenshot(label=name){const path=`${output}/${label}.png`;await page.screenshot({path,fullPage:false});report.screenshots.push(path);}
 return {page,banner,context,load,verify,screenshot,setDate:async value=>{currentNow=value;await page.clock.setFixedTime(new Date(value));}};
}
try{
 if(coversOnly){
  for(const width of [320,390,1280])for(const dark of [false,true])for(const single of [false,true]){
   const name=`covers-${width}-${dark?'dark':'light'}-${single?'single':'multiple'}`,test=await view(name,'2027-01-01T12:00:00Z',single?stamp=>[item('yearly-2026',stamp,{worldId:'cosmos'})]:annual,{width,dark});
   await test.load();const covers=test.page.locator('[data-bloom-shelf] [data-bloom-cover]');await expect(covers.first()).toBeVisible();
   let firstWorld;
   for(const cover of await covers.all()){
    await cover.scrollIntoViewIfNeeded();await cover.locator('img').evaluate(image=>image.decode());
    const layout=await cover.evaluate(element=>{const image=element.querySelector('img'),box=element.getBoundingClientRect(),art=image.getBoundingClientRect();return {world:element.dataset.bloomCover,width:box.width,height:box.height,imageWidth:art.width,imageHeight:art.height,fit:getComputedStyle(image).objectFit,naturalWidth:image.naturalWidth,srcset:image.getAttribute('srcset')};});
    assert.ok(layout.naturalWidth>0,'Authored cover loads');assert.equal(layout.fit,'cover','Artwork fills its surface instead of exposing side gutters');
    assert.ok(Math.abs(layout.width-layout.imageWidth)<1&&Math.abs(layout.height-layout.imageHeight)<1,'Image occupies the full Home cover surface');
    if(width<=750||!single)assert.ok(Math.abs(layout.width/layout.height-4/3)<.01,'Home uses the same authored 4:3 cover proportions as Bloom');
    firstWorld??=layout;report.layouts.push({name,...layout});
   }
   const homeScreenshot=`${output}/${name}-home.png`;await covers.first().screenshot({path:homeScreenshot,animations:'disabled'});report.screenshots.push(homeScreenshot);
   await test.page.goto(base+'/bloom?period=yearly',{waitUntil:'domcontentloaded',timeout:90000});
   const bloomCover=test.page.locator(`[data-bloom-cover="${firstWorld.world}"]`).first();await expect(bloomCover).toBeVisible();await bloomCover.scrollIntoViewIfNeeded();await bloomCover.locator('img').evaluate(image=>image.decode());
   assert.equal(await bloomCover.locator('img').getAttribute('srcset'),firstWorld.srcset,'Home and Bloom use the same illustrated cover source');
   assert.equal(await bloomCover.locator('img').evaluate(image=>getComputedStyle(image).objectFit),'cover');
   const bloomScreenshot=`${output}/${name}-bloom.png`;await bloomCover.screenshot({path:bloomScreenshot,animations:'disabled'});report.screenshots.push(bloomScreenshot);
   report.checks.push(`${name}: Home cover fills its surface and matches Bloom artwork`);await test.context.close();
  }
 }else{
 const weeklyCases=[['weekly-before','2026-11-08T12:00:00Z','anticipation','Opens tomorrow','/bloom?period=weekly'],['weekly-launch','2026-11-09T12:00:00Z','launch','Just opened today','/bloom/weekly-2026-11-02'],['weekly-after','2026-11-10T12:00:00Z','reminder','Opened yesterday','/bloom/weekly-2026-11-02']];
 for(const [name,now,phase,timing,href] of weeklyCases){const test=await view(name,now,weekly);await test.load();await test.verify({period:'weekly',phase,timing,href});await test.screenshot();report.checks.push(`${name}: correct calendar phase, wording and destination`);await test.context.close();}
 {
  const now='2026-11-01T12:00:00Z',test=await view('monthly-priority',now,stamp=>[item('weekly-2026-10-26',stamp),item('monthly-2026-10',stamp,{worldId:'japan'})]);await test.load();await test.verify({period:'monthly',phase:'launch',timing:'Just opened today',href:'/bloom/monthly-2026-10'});await test.screenshot();report.checks.push('Monthly launch wins over weekly anticipation');await test.context.close();
 }
 {
  const now='2026-11-08T12:00:00Z',test=await view('monthly-extra-reminder',now,stamp=>[...weekly(stamp),item('monthly-2026-10',stamp)]);await test.load();await test.verify({period:'monthly',phase:'reminder',href:'/bloom/monthly-2026-10'});report.checks.push('Monthly day-seven campaign remains prominent above weekly anticipation');await test.context.close();
 }
 {
  const now='2026-12-18T12:00:00Z',test=await view('annual-anticipation',now,stamp=>[item('yearly-2026',stamp,{worldId:'glass'})]);await test.load();await test.verify({period:'yearly',phase:'anticipation',timing:'Opens in 14 days',href:'/bloom?period=yearly'});await test.screenshot();report.checks.push('Annual anticipation starts fourteen local calendar days before launch');await test.context.close();
 }
 for(const width of [320,390,1280])for(const dark of [false,true]){
  const name=`annual-priority-${width}-${dark?'dark':'light'}`,test=await view(name,'2027-01-01T12:00:00Z',annual,{width,dark,reduced:true});await test.load();await test.verify({period:'yearly',phase:'launch',timing:'Just opened today',href:'/bloom/yearly-2026'});await test.screenshot();report.checks.push(`${name}: annual beats monthly launch, layout fits and reduced motion honored`);await test.context.close();
 }
 {
  const test=await view('dismissal','2026-11-09T12:00:00Z',weekly,{width:390});await test.load();await test.verify({period:'weekly',phase:'launch',href:'/bloom/weekly-2026-11-02'});await test.banner.getByRole('button',{name:'Dismiss this Bloom reminder'}).click();await test.verify(null);
  await test.load();await test.verify(null);report.checks.push('Dismissed campaign stays hidden across reload');
  await test.setDate('2026-11-10T12:00:00Z');await test.load();await test.verify({period:'weekly',phase:'reminder',timing:'Opened yesterday',href:'/bloom/weekly-2026-11-02'});await test.screenshot('dismissal-next-milestone');report.checks.push('Following-day milestone reappears after launch dismissal');await test.context.close();
 }
 {
  const now='2026-11-09T12:00:00Z',test=await view('suppressed-states',now,stamp=>[item('weekly-2026-11-02',stamp,{completed:true}),item('monthly-2026-10',stamp,{status:'empty'}),item('yearly-2025',stamp,{status:'expired'}),item('yearly-2024',stamp,{status:'archived',completed:true})]);await test.load();await test.verify(null);report.checks.push('Completed, empty, expired and archived blooms have no campaign');await test.context.close();
 }
 }
 assert.deepEqual(report.errors,[],'No browser runtime or hydration errors');
}catch(error){report.errors.push(error.stack||String(error));if(debug&&!debug.isClosed())await debug.screenshot({path:`${output}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await fs.writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,layouts:report.layouts.length,errors:report.errors,report:`${output}/report.json`},null,2));
