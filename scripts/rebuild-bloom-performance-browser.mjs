/** Real Bloom story with bounded artwork preparation and pausable motion. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,webkit,expect as baseExpect} from '@playwright/test';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3092';
const baseline=process.env.SAKURA_BLOOM_PERF_BASELINE==='1';
const engine=process.env.SAKURA_BLOOM_BROWSER||'chromium';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Synthetic auth signing configuration is required.');
const expect=baseExpect.configure({timeout:30000});
const account={id:'90000000-0000-4000-8000-000000000597',username:'Bloom performance fixture'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const chapters=Array.from({length:20},(_,index)=>({id:index===19?'top-song':`chapter-${index}`,kind:'time',title:`A listening chapter ${index+1}.`,prompt:'',stat:{label:'of listening',value:index+1,unit:'hours'},relatedRecording:{id:`80000000-0000-4000-8000-${String(index+597).padStart(12,'0')}`,title:`Prepared song ${index+1}`,artists:['Synthetic artist'],coverUrl:`https://bloom-performance.invalid/cover-${index}.svg`}}));
const shell={id:'monthly-2026-10',period:'monthly',periodStart:'2026-10-01T00:00:00+01:00',periodEnd:'2026-11-01T00:00:00+01:00',publishAt:'2026-11-01T00:00:00+01:00',expiresAt:'2099-11-24T00:00:00+01:00',timeZone:'Africa/Lagos',status:'available',version:3,worldId:'sakura',snapshotCreatedAt:'2026-11-11T08:00:00Z',chapterCount:chapters.length,summary:{audibleMs:3600000,recordingCount:20,playCount:20,activeDays:4}};
const output='.local/bloom-performance';await fs.mkdir(output,{recursive:true});
const report={baseline,engine,base,scope:'Real mobile Bloom UI; signed synthetic account,20chapter saved story,all API writes intercepted.',checks:[],errors:[]};
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true});
let debugPage;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:'no-preference',serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{
  sessionStorage.setItem('sakura-ink-opening','1');
  window.__bloomFrameIntervals=[];let prior;
  const frame=now=>{if(prior!==undefined)window.__bloomFrameIntervals.push(now-prior);prior=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 debugPage=page;
 const images=[],revealed=new Set();let prepares=0;
 const recap=()=>({...shell,completed:false,chapters:chapters.map(chapter=>revealed.has(chapter.id)?{...chapter,revealed:true}:{...chapter,stat:null,relatedRecording:null,revealed:false})});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',privateSession:true,learnFromListening:false,reducedMotion:false,bloomPerformance:'5',onboarded:true,openingAnimation:0}});
  if(path==='/api/v2/image'){images.push(url.searchParams.get('url'));return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#7c9186"/><circle cx="285" cy="120" r="66" fill="#e6c49e"/></svg>'});}
  if(path.endsWith('/prepare')){prepares++;return route.fulfill({json:{story:recap(),chapters}});}
  if(path.endsWith('/reveal')){revealed.add(request.postDataJSON().chapterId);return route.fulfill({json:recap()});}
  if(path===`/api/v2/bloom/${shell.id}`)return route.fulfill({json:recap()});
  return route.fulfill({json:{items:[],recordings:[],session:null,serverTime:Date.now()}});
 });
 await page.goto(`${base}/bloom/${shell.id}`,{waitUntil:'domcontentloaded',timeout:120000});
 const dialog=page.locator('dialog[open]');await dialog.locator('[data-bloom-action="begin"]').waitFor();
 assert.equal(prepares,0);assert.equal(images.length,0,'Opening a story does not download future artwork.');
 await page.waitForTimeout(1000);
 await dialog.locator('[data-bloom-action="begin"]').click();
 await expect(dialog.locator('[aria-current="step"]')).toHaveAttribute('aria-label','Chapter 1: A listening chapter 1.');
 await page.waitForTimeout(1200);
 const count=new Set(images).size;
 if(!baseline){assert.ok(count<=6,`20chapter story prepared ${count} artwork sources`);assert.ok(images.includes(chapters[1].relatedRecording.coverUrl),'The next sleeve is ready before its reveal.');assert.ok(!images.includes(chapters[10].relatedRecording.coverUrl),'Distant artwork waits for its chapter.');}
 report.checks.push({name:'bounded-artwork',chapters:chapters.length,prepares,imageRequests:images.length,uniqueImages:count});
 // Compare the same settled scene rather than mixing server startup, chapter
 // transitions and pauses into a claimed frame-rate improvement.
 await page.waitForTimeout(1600);await page.evaluate(()=>{window.__bloomFrameIntervals=[];});await page.waitForTimeout(1500);
 const frames=await page.evaluate(()=>{const values=window.__bloomFrameIntervals.filter(value=>value>0&&value<1000).sort((a,b)=>a-b);return {count:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],over50ms:values.filter(value=>value>50).length};});
 const animation=await dialog.locator('[data-bloom-world]').evaluate(node=>{
  const all=node.getAnimations({subtree:true}),running=all.filter(animation=>animation.playState==='running');
  window.__bloomMotion=running.find(animation=>animation.effect?.getComputedTiming().iterations===Infinity)||running[0];
  const byClass={};let outside=0;const viewport=node.getBoundingClientRect();
  for(const animation of running){const target=animation.effect?.target;if(!(target instanceof Element))continue;const name=target.getAttribute('class')||target.tagName;byClass[name]=(byClass[name]||0)+1;const bounds=target.getBoundingClientRect();if(bounds.bottom<0||bounds.top>Math.min(innerHeight,viewport.bottom)||bounds.right<0||bounds.left>innerWidth)outside++;}
  return {running:running.length,sleepingDecorations:all.filter(animation=>animation.playState==='paused'&&!('transitionProperty' in animation)).length,svgNodes:node.querySelectorAll('svg *').length,animationsOutsideViewport:outside,animationsByClass:byClass};
 });
 assert.ok(animation.running>0,'Maximum quality retains the rich moving world.');
 if(!baseline)assert.ok(animation.sleepingDecorations>0,'Cropped decorations sleep while the visible world keeps moving.');
 await dialog.getByRole('button',{name:'Play story',exact:true}).click();
 await dialog.getByRole('button',{name:'Pause story',exact:true}).click();
 await expect(dialog).toHaveAttribute('data-paused','true');
 await expect.poll(()=>page.evaluate(()=>window.__bloomMotion?.playState),{message:'World keyframe receives the pause state.'}).toBe('paused');
 await page.evaluate(async()=>{await window.__bloomMotion?.ready;});
 const pausedAt=await page.evaluate(()=>Number(window.__bloomMotion?.currentTime));
 await page.waitForTimeout(400);
 const heldAt=await page.evaluate(()=>Number(window.__bloomMotion?.currentTime));
 report.pauseSample={pausedAt,heldAt};assert.ok(Math.abs(pausedAt-heldAt)<25,'Pausing stops world animation without discarding its art.');
 await dialog.getByRole('button',{name:'Play story',exact:true}).click();
 await expect(dialog).toHaveAttribute('data-paused','false');
 await expect.poll(()=>page.evaluate(()=>Number(window.__bloomMotion?.currentTime)),{message:'World animation resumes from its kept place.'}).toBeGreaterThan(heldAt+100);
 const resumedAt=await page.evaluate(()=>Number(window.__bloomMotion?.currentTime));
 report.checks.push({name:'rich-motion-pause-resume',...animation,pausedAt,heldAt,resumedAt,frames});
 await page.screenshot({path:`${output}/${baseline?'before':'after'}-${engine}-390.png`});
 assert.deepEqual(report.errors,[]);
 await fs.writeFile(`${output}/${baseline?'before':'after'}-${engine}-report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 await context.close();
}catch(error){
 if(debugPage&&!debugPage.isClosed()){
  const state=await debugPage.evaluate(()=>({dialogs:[...document.querySelectorAll('dialog')].map(node=>({open:node.open,paused:node.dataset.paused,phase:node.dataset.openingPhase,buttons:[...node.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label'),text:button.textContent}))})),url:location.href,animation:window.__bloomMotion?{state:window.__bloomMotion.playState,time:window.__bloomMotion.currentTime}:null}));
  await debugPage.screenshot({path:`${output}/failed-${engine}.png`});
  await fs.writeFile(`${output}/failed-${engine}.json`,JSON.stringify({message:error.message,errors:report.errors,pauseSample:report.pauseSample,state},null,2));
 }
 throw error;
}finally{await browser.close();}
