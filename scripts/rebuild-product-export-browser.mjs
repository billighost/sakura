import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

// Every API is intercepted. This harness never visits a deployed origin or writes
// an account; it exercises the production Settings component and native Blob save.
const target=new URL(process.env.SAKURA_TEST_URL||'http://127.0.0.1:3100');
assert.ok(['http:','https:'].includes(target.protocol)&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.pathname==='/'&&!target.username&&!target.password&&!target.search&&!target.hash,'Use a loopback production origin');
const baseline=process.env.SAKURA_PRODUCT_BASELINE==='1';
const account={id:'97090000-0000-4000-8000-000000000611',username:'Export fixture',email:'export@example.invalid'};
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',japaneseReading:false,privateSession:false,discovery:.35,artistVariety:.65,repeatTolerance:.45,newReleaseBias:.5,deepCutBias:.35,timeAware:true,learnFromListening:true,reducedMotion:true,openingAnimation:0,bloomPerformance:'auto',seedArtists:[],seedGenres:[],onboarded:true,timeZone:'Africa/Lagos',explicitContent:true,volume:.8,shuffle:false,repeat:'off',previewVolume:.8,previewLoop:true,sleepTimerMinutes:15,revision:1,fieldRevisions:{}};
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Local signing configuration is required');
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const payload={version:2,__exportFixture:true,accountId:account.id,listeningMeasurements:Array.from({length:10000},(_,n)=>({eventId:String(n),sequence:n,audibleMs:'5000',occurredAt:null,receivedAt:'2026-11-11T12:00:00Z',completed:false,skipped:false}))};
const body=JSON.stringify(payload),errors=[],requests=[],downloads=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true,viewport:{width:390,height:844}});
 await context.addCookies([{name:'authjs.session-token',value:token,url:target.origin}]);
 await context.addInitScript(({account,settings})=>{
  sessionStorage.setItem('sakura-ink-opening','1');localStorage.setItem('sakura-v2-active-account',account.id);
  localStorage.setItem('sakura-v2-preferences:'+account.id,JSON.stringify({settings,pending:false,savedAt:Date.now()}));
  const metrics=window.__exportMetrics={parse:0,stringify:0,created:0,revoked:0};
  const parse=JSON.parse,stringify=JSON.stringify,create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  JSON.parse=function(value,...args){if(typeof value==='string'&&value.includes('"__exportFixture":true'))metrics.parse++;return Reflect.apply(parse,JSON,[value,...args]);};
  JSON.stringify=function(value,...args){if(value?.__exportFixture===true)metrics.stringify++;return Reflect.apply(stringify,JSON,[value,...args]);};
  URL.createObjectURL=function(value){metrics.created++;return Reflect.apply(create,URL,[value]);};
  URL.revokeObjectURL=function(value){metrics.revoked++;return Reflect.apply(revoke,URL,[value]);};
 },{account,settings});
 let fail=false;
 await context.route('**/*',route=>new URL(route.request().url()).origin===target.origin?route.fallback():route.abort());
 await context.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()!=='GET')return route.fulfill({status:409,json:{error:'Fixture rejects unexpected mutation'}});
  if(path==='/api/v2/personalization/data'){
   requests.push({dto:request.headers()['x-sakura-dto'],account:request.headers()['x-sakura-account']});
   if(!baseline)assert.equal(request.headers()['x-sakura-dto'],'3');assert.equal(request.headers()['x-sakura-account'],account.id);
   return route.fulfill(fail?{status:503,json:{error:'Unavailable'}}:{status:200,body,headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="sakura-export-fixture.json"'}});
  }
  if(path==='/api/v2/bootstrap'||path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:settings});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});
  if(path==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[],historyDeletions:[]}});
  if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
  return route.fulfill({json:{artists:[],mixes:[],events:[],items:[],entries:[],blooms:[]}});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(45000);await page.goto(target.origin+'/settings',{waitUntil:'domcontentloaded',timeout:90000});
 const button=page.getByRole('button',{name:'Export my data',exact:true});await expect(button).toBeEnabled();
 for(let run=0;run<2;run++){
  const download=page.waitForEvent('download');await button.click();const file=await download;
  const saved=await fs.readFile(await file.path());const parsed=JSON.parse(saved.toString('utf8'));
  assert.deepEqual(parsed,payload);downloads.push({run:run+1,bytes:saved.length,rows:parsed.listeningMeasurements.length});
  await expect(button).toBeEnabled();
 }
 fail=true;await button.click();await expect(button).toBeEnabled();
 await expect.poll(()=>requests.length).toBe(3);
 await expect.poll(()=>page.evaluate(()=>window.__exportMetrics.created-window.__exportMetrics.revoked)).toBe(0);
 const metrics=await page.evaluate(()=>window.__exportMetrics);
 if(!baseline){assert.equal(metrics.parse,0);assert.equal(metrics.stringify,0);assert.equal(downloads[0].bytes,Buffer.byteLength(body));}
 assert.deepEqual(errors,[]);
 const report={checkedAt:new Date().toISOString(),baseline,scope:'Loopback production Settings, Chromium390px, intercepted APIs,10000 synthetic measurements. Structural checks, not production percentiles or physical iOS.',inputBytes:Buffer.byteLength(body),downloads,metrics,requests,errors};
 await fs.mkdir('.local',{recursive:true});await fs.writeFile(`.local/product-export-${baseline?'baseline':'current'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 await context.close();
}finally{await browser.close();}
