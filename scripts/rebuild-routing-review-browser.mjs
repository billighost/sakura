import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const target=new URL(process.env.SAKURA_TEST_URL||'http://127.0.0.1:3117');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&!target.username&&!target.password&&target.pathname==='/'&&!target.search&&!target.hash,'Routing review must use a loopback build');
const account={id:'97290000-0000-4000-8000-000000000411',username:'Routing fixture',email:'routing@example.invalid'};
const settings={revision:0,fieldRevisions:{},theme:'light',audioTechnology:'none',audioQuality:'balanced',privateSession:false,learnFromListening:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],seedArtistSelections:[],volume:.8,shuffle:false,repeat:'off',timeZone:'Africa/Lagos'};
const track={recordingId:'97290000-0000-4000-8000-000000000412',metadata:{title:'Routing search fixture',artists:['Routing artist'],durationMs:120000},reference:{provider:'deezer',id:'routing-fixture'},references:[{provider:'deezer',id:'routing-fixture'}],coverUrl:null};
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:390,height:844}}),errors=[],api=[],rsc=[];
let releaseOldPage=()=>{};const oldPageGate=new Promise(resolve=>{releaseOldPage=resolve;});
// API interception cannot intercept Server Component database reads. Block the
// root/share endpoints too; their session/share lookups are outside this fixture.
await context.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/'||path.startsWith('/s/'))return route.abort('blockedbyclient');return route.fallback();});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Local signing configuration required');
await context.addCookies([{name:'authjs.session-token',value:await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'}),url:target.origin}]);
await context.addInitScript(({account,settings})=>{sessionStorage.setItem('sakura-ink-opening','1');localStorage.setItem('sakura-v2-active-account',account.id);localStorage.setItem('sakura-v2-preferences:'+account.id,JSON.stringify({settings,pending:false,savedAt:Date.now()}));},{account,settings});
await context.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();api.push({path,search:url.search,method});
 const json=value=>route.fulfill({json:value});
 if(path==='/api/v2/bootstrap')return json({profile:account});
 if(path==='/api/v2/settings')return json(settings);
 if(path==='/api/v2/profile')return json({profile:account,stats:{},topArtists:[],topSongs:[],insights:{topSongs:[]}});
 if(path==='/api/v2/library/state')return json({favoriteStates:{}});
 if(path==='/api/v2/library')return json({recordings:[],playlists:[],nextCursor:null});
 if(path==='/api/v2/taste')return json({feedback:[],tasteEvidence:[]});
 if(path==='/api/v2/listening-session')return json({session:null,serverTime:Date.now()});
 if(path==='/api/v2/collection-view')return json({preference:null});
 if(path==='/api/v2/feed'||path==='/api/v2/feed/hero'){const item={track,lane:'similar',reason:'Routing fixture'};return json(path.endsWith('/hero')?{item,refreshAt:Date.now()+600000}:{items:[item],sections:[],nextCursor:null,personalized:true,totalCandidates:1,generatedAt:new Date().toISOString(),hero:{item,refreshAt:Date.now()+600000}});}
 if(path==='/api/v2/mixes')return json({mixes:[]});
 if(path==='/api/v2/bloom/shelf')return json({blooms:[],entries:[]});
 if(path==='/api/v2/search/suggestions')return json({artists:[],learningEnabled:true});
 if(path==='/api/v2/artists')return json({artists:[{id:'deezer:42',name:'Routing artist',reference:{provider:'deezer',id:'42'}}]});
 if(path==='/api/v2/search'){
  const q=url.searchParams.get('q'),cursor=url.searchParams.get('cursor');
  if(q==='Stalled paging'&&cursor){await oldPageGate;return route.fulfill({json:{tracks:[],artists:[],albums:[],nextCursors:{tracks:null,artists:null,albums:null}}}).catch(()=>{});}
  return json({tracks:[track],artists:[{id:'deezer:42',name:'Routing artist',reference:{provider:'deezer',id:'42'}}],albums:[{id:'deezer:43',title:'Routing album'}],totals:{tracks:1,artists:1,albums:1},nextCursors:{tracks:!cursor&&['Stalled paging','New paging'].includes(q)?'1':null,artists:null,albums:null}});
 }
 if(path==='/api/auth/csrf')return json({csrfToken:'synthetic-csrf'});
 if(path==='/api/auth/providers')return json({credentials:{id:'credentials',name:'Credentials',type:'credentials',signinUrl:target.origin+'/api/auth/signin/credentials',callbackUrl:target.origin+'/api/auth/callback/credentials'}});
 if(path==='/api/auth/callback/credentials'&&method==='POST')return json({url:target.origin+'/home'});
 if(path==='/api/auth/session')return json({user:account,expires:'2099-01-01T00:00:00.000Z'});
 errors.push('Unexpected intercepted API '+method+' '+path);return route.fulfill({status:503,json:{error:'Unexpected fixture API'}});
});
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.headers().rsc==='1'){const url=new URL(request.url()),headers=request.headers();rsc.push({path:url.pathname,search:url.search,at:Date.now(),prefetch:headers['next-router-prefetch']||null,segmentPrefetch:headers['next-router-segment-prefetch']||null});}});
const report={url:target.origin,search:{},paging:{},onboarding:{},login:{skipped:'Root/login authority remains conditional; root-prefetch blocking would distort this isolated browser trace.'},errors};
try{
 await page.goto(target.origin+'/search',{waitUntil:'domcontentloaded',timeout:90000});
 const input=page.getByRole('searchbox',{name:'Search music',exact:true});await expect(input).toBeVisible();
 let start=rsc.length;
 for(const query of ['Fixture one','Fixture two']){await input.fill(query);await expect(page).toHaveURL(url=>url.searchParams.get('q')===query);await expect(page.getByRole('heading',{name:'Results for “'+query+'”'})).toBeVisible();await page.waitForTimeout(100);}
 report.search.inputRsc=rsc.slice(start);start=rsc.length;
 for(const tab of ['Artists','Albums','Songs']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(100);}
 report.search.tabRsc=rsc.slice(start);start=rsc.length;
 await page.evaluate(()=>history.replaceState(null,'','/search?q=Native%20fixture&tab=Artists'));
 await expect(input).toHaveValue('Native fixture');await expect(page.getByRole('button',{name:'Artists',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('heading',{name:'Results for “Native fixture”'})).toBeVisible();await page.waitForTimeout(500);
 report.search.nativeRsc=rsc.slice(start);assert.equal(report.search.nativeRsc.filter(request=>request.path==='/search').length,0,'Documented native query state must not start RSC navigation');
 await page.getByRole('button',{name:'Songs',exact:true}).click();await input.fill('Stalled paging');
 const pageRequest=(query)=>api.filter(request=>request.path==='/api/v2/search'&&new URLSearchParams(request.search).get('q')===query&&new URLSearchParams(request.search).has('cursor')).length;
 await expect.poll(()=>pageRequest('Stalled paging')).toBeGreaterThan(0);
 await input.fill('New paging');await expect(page).toHaveURL(url=>url.searchParams.get('q')==='New paging');await expect(page.getByRole('heading',{name:'Results for “New paging”'})).toBeVisible();await page.waitForTimeout(750);
 report.paging.newQueryRequestsBeforeOldRelease=pageRequest('New paging');
 if(process.env.SAKURA_ROUTING_EXPECT_OPTIMIZED==='1')assert.ok(report.paging.newQueryRequestsBeforeOldRelease>0,'A stalled old page must not block the new query paging');
 releaseOldPage();await page.waitForTimeout(100);
 if(!pageRequest('New paging'))await page.getByRole('button',{name:'Show more results',exact:true}).click();
 await expect.poll(()=>pageRequest('New paging')).toBeGreaterThan(0);
 await page.goto(target.origin+'/onboarding',{waitUntil:'domcontentloaded'});const apiStart=api.length;
 await page.getByRole('searchbox',{name:'Find favorite artists',exact:true}).fill('Onboarding artist');
 await expect.poll(()=>api.slice(apiStart).filter(request=>request.path==='/api/v2/search').length).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Routing artist',exact:true})).toBeVisible();
 report.onboarding.search=api.slice(apiStart).filter(request=>request.path==='/api/v2/search');
 if(process.env.SAKURA_ROUTING_EXPECT_OPTIMIZED==='1')assert.ok(report.onboarding.search.every(request=>new URLSearchParams(request.search).get('kind')==='artists'));
 assert.deepEqual(errors,[]);
 report.api=api;
 await mkdir('.local',{recursive:true});await writeFile(process.env.SAKURA_ROUTING_REPORT||'.local/routing-review-browser.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({url:report.url,search:{inputRouteRequests:report.search.inputRsc.filter(request=>request.path==='/search').length,tabRouteRequests:report.search.tabRsc.filter(request=>request.path==='/search').length,nativeRouteRequests:report.search.nativeRsc.filter(request=>request.path==='/search').length},paging:report.paging,onboarding:report.onboarding,login:report.login,errors}));
}finally{releaseOldPage();await browser.close();}
