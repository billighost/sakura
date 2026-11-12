/** Home/Discover cold-open proof with persisted synthetic selections and unavailable data. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=baseExpect.configure({timeout:30000}),base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Local auth signing configuration is required');
const account={id:'94090000-0000-4000-8000-000000000411',username:'Offline feed fixture',email:'offline-feed@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const tracks=['Saved home song','Saved discovery song','Home hero song','Discovery hero song'].map((title,index)=>({id:`95090000-0000-4000-8000-${String(411+index).padStart(12,'0')}`,title,artists:['Offline fixture'],albumTitle:'Saved selection',durationMs:40000,coverUrl:null,artistId:null,albumId:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(411+index)},references:[{provider:'deezer',id:String(411+index)}]}));
const settings={theme:'light',audioTechnology:'none',audioQuality:'data-saver',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.35,volume:.5,shuffle:false,repeat:'off',revision:1,fieldRevisions:{},learnFromListening:true,timeZone:'Africa/Lagos'};
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),page=await context.newPage();
await fs.mkdir('.local/offline-feed',{recursive:true});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');if(localStorage.getItem('offline-feed-force')==='1')Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});
let blocked=false,empty=false;const counts={feeds:0,heroes:0,blocked:0},errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
await context.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 if(path.startsWith('/api/v2/feed')){
  if(blocked){counts.blocked++;return route.abort('internetdisconnected');}
  const discover=url.searchParams.get('surface')==='discover';
  if(path.endsWith('/hero')){counts.heroes++;return route.fulfill({json:{item:empty?null:{track:tracks[discover?3:2],reason:'Saved hero fixture',lane:'similar'},refreshAt:Date.now()+3600000}});}
  counts.feeds++;return route.fulfill({json:{items:empty?[]:[{track:tracks[discover?1:0],reason:'Saved selection fixture',lane:'similar'}],sections:[],nextCursor:null,personalized:true,totalCandidates:empty?0:1,generatedAt:new Date().toISOString()}});
 }
 if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
 if(path==='/api/v2/settings')return route.fulfill({json:settings});
 if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
 if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
 return route.fulfill({json:{items:[],recordings:[],playlists:[],nextCursor:null,schedule:{timeZone:'Africa/Lagos'}}});
});
async function visit(surface){await page.goto(base+'/'+surface,{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator(`[data-personalized-feed="${surface}"]`)).toBeVisible();}
async function expectSelection(surface){const feed=page.locator(`[data-personalized-feed="${surface}"]`);await expect(feed.getByRole('link',{name:surface==='home'?'Saved home song':'Saved discovery song',exact:true})).toBeVisible();await expect(feed.getByRole('link',{name:surface==='home'?'Home hero song':'Discovery hero song',exact:true})).toBeVisible();}
try{
 await visit('home');await expectSelection('home');await visit('discover');await expectSelection('discover');assert.ok(counts.feeds>=2&&counts.heroes>=2);const seeded={...counts};checks.push('Home and Discover save their song selection and independent hero on the first visit.');
 await page.evaluate(()=>localStorage.setItem('offline-feed-force','1'));blocked=true;
 await visit('home');await expectSelection('home');await visit('discover');await expectSelection('discover');assert.deepEqual(counts,seeded);checks.push('Cold Home and Discover opens restore both selections and heroes while offline with zero attempted feed requests.');
 await page.screenshot({path:'.local/offline-feed/saved-discover.png'});
 await page.evaluate(accountId=>window.dispatchEvent(new CustomEvent('sakura-listening-erased',{detail:{accountId}})),account.id);
 await expect(page.locator('[data-personalized-feed] [data-song-id]')).toHaveCount(0);await visit('discover');await expect(page.locator('[data-personalized-feed] [data-song-id]')).toHaveCount(0);assert.equal(counts.blocked,0);checks.push('An offline erasure clears retained explanations immediately and prevents them from returning after reload.');
 blocked=false;empty=true;await page.evaluate(()=>localStorage.removeItem('offline-feed-force'));await visit('discover');await expect(page.getByRole('heading',{name:'No recommendations yet.',exact:true})).toBeVisible();assert.equal(counts.feeds,seeded.feeds+1);checks.push('Reconnection replaces the erased selection with the current server response.');
 assert.deepEqual(errors,[]);const report={checkedAt:new Date().toISOString(),counts,checks,errors};await fs.writeFile('.local/offline-feed/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:'.local/offline-feed/failure.png'}).catch(()=>{});console.error(JSON.stringify({counts,checks,errors,url:page.url()}));throw error;}
finally{await context.close();await browser.close();}
