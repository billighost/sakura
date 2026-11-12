import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'next-auth/jwt';
import {chromium,expect} from '@playwright/test';
import {DEFAULT_SETTINGS} from '../src/rebuild/data/validation.ts';
import {buildInitialTasteProfile} from '../src/rebuild/recommendations/initialTaste.ts';
import {rankPersonalizedTracks} from '../src/rebuild/recommendations/personalization.ts';
import {rankSearchArtists} from '../src/rebuild/recommendations/searchArtists.ts';

// Signed synthetic account and intercepted APIs. PostgreSQL generation is
// verified separately; this suite exercises rendered controls and stale previews.
const base=process.env.SAKURA_TEST_URL||'http://localhost:3014',secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Browser fixture needs the existing auth signing configuration');
const account={id:'97000000-0000-4000-8000-000000000001',username:'onboarding_fixture',email:'onboarding@example.invalid',createdAt:'2026-11-08T00:00:00Z'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const artists=[{id:'97000000-0000-4000-8000-000000000002',name:'First Artist',reference:{provider:'deezer',id:'991001'}},{id:'97000000-0000-4000-8000-000000000003',name:'The Artist With a Long Name That Extends Across a Quiet Listening Room',reference:{provider:'deezer',id:'991002'}}];
const tracks=artists.map((artist,index)=>{
 const id=`97000000-0000-4000-8000-${String(10+index).padStart(12,'0')}`,metadata={title:`Onboarding fixture ${index}`,artists:[artist.name],durationMs:180000,genres:[index?'Folk':'Jazz'],version:{kinds:['original'],labels:[]}};
 return {id,recordingId:id,...metadata,metadata,artistId:artist.id,artistCredits:[{name:artist.name,artistId:artist.id,role:'primary',reference:artist.reference}],reference:{provider:'deezer',id:String(992001+index)},references:[{provider:'deezer',id:String(992001+index)}],playability:'resolvable'};
});
const checks=[],screenshots=[],errors=[],touchTargets=[];
await fs.mkdir('.local',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const shape of [{width:1280,height:720},{width:390,height:844},{width:320,height:740}]){
  const label=String(shape.width),context=await browser.newContext({viewport:shape,colorScheme:shape.width===320?'dark':'light',reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(`${label}: ${error.message}`));
  const settings={...DEFAULT_SETTINGS,theme:shape.width===320?'dark':'light',openingAnimation:0,reducedMotion:true,seedArtists:[],seedGenres:[],seedArtistSelections:[],onboarded:false,revision:0,fieldRevisions:{}};
  const requests=[],previewRequests=[];let delayFirst=true,failNextSettings=false;
  function remoteChoice(artist){settings.seedArtists=[artist.name];settings.seedArtistSelections=[{name:artist.name,reference:artist.reference,selectionKey:`artist:${artist.reference.provider}:${artist.reference.id}`}];settings.revision++;settings.fieldRevisions.seedArtists=settings.revision;settings.fieldRevisions.seedArtistSelections=settings.revision;settings.initialTasteProfile=buildInitialTasteProfile(tracks,settings);}
  const profile=()=>({profile:account,stats:{audibleMs:0,playCount:0,uniqueRecordings:0,completedCount:0,skippedCount:0,liked:0,playlists:0},topArtists:[],onboarding:{seedArtists:settings.seedArtists,seedGenres:[],initialTasteGenres:settings.initialTasteProfile?.genres.map(genre=>genre.name)||[]},insights:{days:[],hours:[],genres:[],completionRate:0,skipRate:0,finishedEvents:0,activeDays:0,confidence:{level:'starting',label:'Your recommendations start here.',evidence:'Chosen artists guide your first recommendations.'},topSongs:[],timeZone:'Africa/Lagos'}});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),body=method==='GET'?undefined:request.postDataJSON();requests.push({path,method,body});
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:profile()});
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/settings'){
    if(method==='PATCH'){
     assert.ok(!('initialTasteProfile' in body),'Read-only generated data must not enter a settings PATCH');
     if(failNextSettings){failNextSettings=false;return route.fulfill({status:400,json:{error:'Unsupported setting'}});}
     const {expectedRevision,...patch}=body;assert.equal(expectedRevision,settings.revision);Object.assign(settings,patch);settings.revision++;for(const key of Object.keys(patch))settings.fieldRevisions[key]=settings.revision;
     settings.initialTasteProfile=buildInitialTasteProfile(tracks,settings);
    }
    return route.fulfill({json:settings});
   }
   if(path==='/api/v2/artists')return route.fulfill({json:{artists}});
   if(path==='/api/v2/onboarding/preview'){
    previewRequests.push(body);const profile=buildInitialTasteProfile(tracks,{...settings,...body});
    if(delayFirst){delayFirst=false;await new Promise(resolve=>setTimeout(resolve,2000));}
    return route.fulfill({json:{genres:profile.genres.map(genre=>genre.name),matchedArtists:profile.artists.filter(artist=>artist.recordings.length).length,selectedArtists:profile.artists.length}}).catch(()=>{});
   }
   if(path==='/api/v2/taste')return route.fulfill({json:{feedback:[],tasteEvidence:[],initialTasteProfile:settings.initialTasteProfile,historyClearedAt:null}});
   if(path==='/api/v2/listening-session')return route.fulfill({json:{session:null,serverTime:Date.now()}});
   if(path==='/api/v2/feed')return route.fulfill({json:{items:rankPersonalizedTracks(tracks,{settings}).map(({track,reason,lane})=>({track,reason,lane})),sections:[],nextCursor:null,personalized:Boolean(settings.seedArtists.length),totalCandidates:tracks.length,generatedAt:new Date().toISOString()}});
   if(path==='/api/v2/search/suggestions')return route.fulfill({json:{artists:rankSearchArtists(artists,tracks,{settings}),learningEnabled:true}});
   if(path==='/api/v2/bloom')return route.fulfill({json:{windows:[],recaps:[],stories:[]}});
   return route.fulfill({json:{items:[],recordings:[],artists:[],playlists:[],albums:[]}});
  });
  async function load(path){await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('#music-main h1').first().waitFor();}
  async function capture(name){await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>![...document.querySelectorAll('[class*="toast"]')].some(element=>element.textContent?.trim()),{},{timeout:8000});const target=`.local/onboarding-${label}-${name}.png`;await page.screenshot({path:target});screenshots.push(target);const overflow=await page.evaluate(()=>{const main=document.querySelector('#music-main');return {document:document.documentElement.scrollWidth-innerWidth,main:main.scrollWidth-main.clientWidth};});assert.ok(overflow.document<=1&&overflow.main<=1,`${label} ${name}: ${JSON.stringify(overflow)}`);checks.push(`${label}px ${name} fits horizontally`);}
  async function verifySaveAction(){
   const save=page.getByRole('button',{name:'Save and continue',exact:true});await save.scrollIntoViewIfNeeded();
   const appearance=await save.evaluate(button=>{
    const style=getComputedStyle(button),rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
    const luminance=channels=>channels.slice(0,3).map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const foreground=rgb(style.color),background=rgb(style.backgroundColor),front=luminance(foreground),back=luminance(background);
    return {height:button.getBoundingClientRect().height,backgroundAlpha:background[3]??1,contrast:(Math.max(front,back)+.05)/(Math.min(front,back)+.05)};
   });
   assert.equal(appearance.backgroundAlpha,1,`${label}px save action needs an opaque background`);assert.ok(appearance.contrast>=4.5,`${label}px save action contrast is ${appearance.contrast}`);assert.ok(appearance.height>=44,`${label}px save target is ${appearance.height}px`);touchTargets.push({width:shape.width,name:'save',...appearance});checks.push(`${label}px save action is readable and at least 44px`);await capture('save');
  }
  await load('/onboarding');await expect(page.getByRole('button',{name:'Continue without artists',exact:true})).toBeVisible();await expect(page.getByRole('complementary',{name:'Your first recommendations'})).toHaveCount(0);
  await page.getByRole('button',{name:artists[0].name,exact:true}).click();await expect(page.getByRole('complementary',{name:'Your first recommendations'})).toContainText('Checking');await expect.poll(()=>previewRequests.length).toBe(1);
  const firstRemoval=page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true}),shortHeight=await firstRemoval.evaluate(button=>button.getBoundingClientRect().height);touchTargets.push({width:shape.width,name:'short',height:shortHeight});assert.ok(shortHeight>=44,`${label}px short artist removal target is ${shortHeight}px`);
  await firstRemoval.click();await page.getByRole('button',{name:artists[1].name,exact:true}).click();
  const preview=page.getByRole('complementary',{name:'Your first recommendations'});await expect(preview).toContainText('Folk');await page.waitForTimeout(2100);await expect(preview).not.toContainText('Jazz');checks.push(`${label}px delayed preview cannot restore a removed artist's genres`);
  const remove=page.getByRole('button',{name:`Remove ${artists[1].name}`,exact:true}),height=await remove.evaluate(button=>button.getBoundingClientRect().height);touchTargets.push({width:shape.width,name:'long',height});assert.ok(height>=44,`${label}px chosen artist removal target is ${height}px`);
  remoteChoice(artists[0]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:`Remove ${artists[1].name}`,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true}).click();await page.getByRole('button',{name:artists[1].name,exact:true}).click();remoteChoice(artists[1]);remoteChoice(artists[0]);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:`Remove ${artists[1].name}`,exact:true})).toHaveCount(0);assert.equal(requests.filter(request=>request.path==='/api/v2/settings'&&request.method==='PATCH').length,0);checks.push(`${label}px mounted draft reconciles newer artist choices, including an unseen change and revert`);
  await page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true}).click();await page.getByRole('button',{name:artists[1].name,exact:true}).click();await expect(preview).toContainText('Folk');await page.locator('#music-main').evaluate(main=>{main.scrollTop=0;});await capture('choices');await preview.evaluate(element=>element.scrollIntoView({block:'start'}));await capture('preview');await verifySaveAction();await page.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(page).toHaveURL(/\/home$/);assert.deepEqual(settings.seedArtists,[artists[1].name]);assert.equal(settings.initialTasteProfile.origin,'chosen-artists');assert.deepEqual(settings.initialTasteProfile.genres.map(genre=>genre.name),['Folk']);checks.push(`${label}px artist choices save a distinct generated starting profile`);
  await load('/profile');await expect(page.getByText('No listening has been recorded yet.',{exact:false})).toBeVisible();await page.getByText('Your chosen starting points',{exact:true}).click();await expect(page.locator('details').filter({has:page.getByText('Your chosen starting points',{exact:true})})).toContainText('Folk');await expect(page.getByRole('region',{name:'Genres you listened to'})).not.toContainText('Folk');await expect(page.getByText('No recorded finishes or skips yet.',{exact:true})).toBeVisible();await capture('profile');checks.push(`${label}px starting choices stay separate from empty listening charts`);
  await load('/search');const suggestions=page.getByRole('region',{name:'Artist suggestions'});await expect(suggestions.getByRole('button').first()).toHaveAttribute('aria-label',`Search for ${artists[1].name}`);await capture('search');await suggestions.getByRole('button').first().click();await expect(page.getByRole('searchbox',{name:'Search music',exact:true})).toHaveValue(artists[1].name);checks.push(`${label}px Search uses the chosen artist and fills its full name`);
  assert.equal(requests.filter(request=>request.path==='/api/v2/history'&&request.method==='POST').length,0);checks.push(`${label}px onboarding, Profile, and Search generate no listening events`);
  if(shape.width===1280){
   await load('/onboarding');await page.getByRole('button',{name:`Remove ${artists[1].name}`,exact:true}).click();await page.getByRole('button',{name:artists[0].name,exact:true}).click();failNextSettings=true;await page.getByRole('button',{name:'Save and continue',exact:true}).click();const retry=page.getByRole('alert').getByRole('button',{name:'Try again',exact:true});await expect(retry).toBeVisible();await page.getByRole('button',{name:`Remove ${artists[0].name}`,exact:true}).click();await page.getByRole('button',{name:artists[1].name,exact:true}).click();await retry.click();await expect(page).toHaveURL(/\/home$/);assert.deepEqual(settings.seedArtists,[artists[1].name]);checks.push('Mounted retry saves the current artist draft rather than the failed older draft');
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);const report={passed:checks.length,checks,errors,touchTargets,screenshots,fixture:'Controlled signed account; intercepted catalog/settings/profile APIs. Database generation is covered by the isolated onboarding PostgreSQL suite.'};await fs.writeFile('.local/onboarding-preview-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
