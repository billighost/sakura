import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import 'dotenv/config';
import {encode} from 'next-auth/jwt';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3012';
const engine=process.env.SAKURA_MOBILE_BROWSER||'chromium';
const browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
const account={id:'90000000-0000-4000-8000-000000000091',username:'Focus fixture',email:'focus@example.invalid'};
const track={id:'80000000-0000-4000-8000-000000000091',title:'Focus fixture song',artists:['Synthetic artist'],durationMs:24000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:'91'},references:[{provider:'deezer',id:'91'}]};
const playlist={id:'70000000-0000-4000-8000-000000000091',name:'Focus collection',recordings:[track],trackCount:1,revision:1};
const settings={theme:'light',audioQuality:'high',audioTechnology:'none',privateSession:false,discovery:.35,reducedMotion:false,openingAnimation:0,bloomPerformance:'auto',seedArtists:[],seedGenres:[],onboarded:true,volume:.8,shuffle:false,repeat:'off',previewVolume:.8,previewLoop:true,sleepTimerMinutes:15};
const fields='input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]),select,textarea';
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(60000);
const checks=[],errors=[];let session=null;page.on('pageerror',error=>{errors.push(error.message);console.error(JSON.stringify({message:error.message,stack:error.stack,url:page.url()}));});
await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
await context.route('**/api/**',route=>{
 const request=route.request(),path=new URL(request.url()).pathname;
 if(path==='/api/v2/listening-session'&&request.method()==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:(session?.revision||0)+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
 const data=path==='/api/v2/profile'?{profile:account}:path==='/api/v2/settings'?settings:path==='/api/v2/listening-session'?{session,serverTime:Date.now()}:path==='/api/v2/library'?{recordings:[{...track,liked:true}],playlists:[playlist]}:path.startsWith('/api/v2/playlists/')?playlist:path==='/api/v2/recordings/'+track.id?{recording:track}:path==='/api/v2/shares'?{url:base+'/s/focus-fixture'}:path==='/api/v2/lyrics'?{lines:[],status:'unavailable'}:path==='/api/v2/audio-preview'?{error:'Synthetic preview has no audio'}:{items:[],recordings:[]};
 return route.fulfill({status:path==='/api/v2/audio-preview'?503:200,json:data});
});
async function visit(path,label){if(page.url()!=='about:blank')await page.waitForLoadState('networkidle');await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});if(label)await page.getByRole('searchbox',{name:label,exact:true}).waitFor();await page.waitForLoadState('networkidle');}
async function check(label){
 const visible=await page.locator(fields).evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width>1&&e.getBoundingClientRect().height>1).map(e=>({label:e.getAttribute('aria-label')||e.name||e.type||e.tagName,font:Number.parseFloat(getComputedStyle(e).fontSize)})));
 assert.ok(visible.length,label+' must have a visible input');for(const field of visible)assert.ok(field.font>=16,label+': '+JSON.stringify(field));
 for(const field of await page.locator(fields).all())if(await field.isVisible()){
  const before=await page.evaluate(()=>visualViewport?.scale||1);await field.focus();const after=await page.evaluate(()=>visualViewport?.scale||1);assert.equal(after,before,label+' focus must preserve viewport scale');
 }
 checks.push({label,fields:visible});console.log(engine+': '+label+' uses 16px fields');
}
try{
 for(const path of ['/login','/register']){await visit(path);await page.locator('input').first().waitFor();await check(path);}
 const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;assert.ok(secret,'Auth signing configuration is required for the synthetic browser fixture');
 const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 for(const [path,label] of [['/search','Search music'],['/library/downloaded','Find a downloaded song'],['/liked','Find a liked song'],['/onboarding','Find favorite artists']]){await visit(path,label);await check(path);}
 await visit('/import');await page.getByRole('textbox',{name:'Playlist link',exact:true}).waitFor();await check('/import');
 await visit('/library','Find in your library');await page.getByRole('button',{name:'New playlist',exact:true}).click();await page.getByRole('textbox',{name:'A name for your collection'}).waitFor();await check('library search and playlist name');
 await visit('/playlist/'+playlist.id,'Find a song in this playlist');await page.getByRole('button',{name:'Rename playlist',exact:true}).click();await page.getByRole('textbox',{name:'Playlist name'}).waitFor();await check('playlist search and rename');
 await visit('/settings');await page.getByRole('combobox',{name:'Appearance',exact:true}).waitFor();await check('settings selectors');
 for(const width of [320,390,932]){await page.setViewportSize({width,height:width>900?430:844});await check('settings at '+width+'px');const fit=await page.locator('#music-main').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(fit.scroll<=fit.width+1,'Settings overflow: '+JSON.stringify(fit));}
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Preview the difference',exact:true}).click();await page.getByRole('combobox',{name:'Compare with',exact:true}).waitFor();await check('audio comparison selector');
 const radio=await page.locator('input[type=radio]').first().evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.deepEqual(radio,{width:1,height:1});
 const file=await page.locator('input[type=file]').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));assert.deepEqual(file,{width:1,height:1});checks.push({label:'Hidden radio and audio-file controls retain their 1px size'});
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await visit('/library','Find in your library');await page.getByRole('button',{name:'More options for '+track.title,exact:true}).click();await page.getByRole('menuitem',{name:'Share this song',exact:true}).click();await page.getByRole('combobox',{name:'Card size',exact:true}).waitFor();await check('share-card selector');
 await page.getByRole('dialog').getByRole('button',{name:'Link',exact:true}).click();await page.getByRole('button',{name:'Prepare share link',exact:true}).click();await page.getByRole('textbox',{name:'Your public share link',exact:true}).waitFor();await check('public share-link field');
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>{const field=document.createElement('textarea');field.setAttribute('aria-label','Textarea regression probe');field.style.fontSize='10px';document.querySelector('#music-main').appendChild(field);});assert.equal(await page.getByRole('textbox',{name:'Textarea regression probe'}).evaluate(e=>getComputedStyle(e).fontSize),'16px');checks.push({label:'Textarea overrides remain at 16px'});
 const meta=await page.locator('meta[name=viewport]').getAttribute('content');assert.match(meta,/maximum-scale=1/);assert.match(meta,/user-scalable=no/);checks.push({label:'Viewport requests maximum scale 1 and disables user scaling',meta});
 assert.deepEqual(errors,[]);await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/iphone-input-'+engine+'-report.json',JSON.stringify({engine,checks,pageErrors:errors,limitation:'Desktop mobile emulation verifies CSS and focus scale; it does not certify the native iPhone keyboard or Safari pinch-zoom policy.'},null,2));console.log(JSON.stringify({engine,checks:checks.length,pageErrors:errors}));
}catch(error){await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/iphone-input-'+engine+'-failure.json',JSON.stringify({engine,checks,pageErrors:errors,error:String(error)},null,2));await page.screenshot({path:'.local/iphone-input-'+engine+'-failure.png'}).catch(()=>{});throw error;}finally{await browser.close()}
