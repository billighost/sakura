/** Real mobile settings and collection screens, with synthetic APIs and local audio only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect = baseExpect.configure({timeout:20000});
const base = process.env.SAKURA_TEST_URL || 'http://localhost:3016';
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, 'Local auth signing configuration is required');
const account = {id:'90000000-0000-4000-8000-000000000212', username:'Responsive fixture', email:'responsive@example.invalid'};
const token = await encode({token:{id:account.id, name:account.username}, secret, salt:'authjs.session-token'});
const samples=24000*18, wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*330/24000)*1400),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['Zulu morning','Alpha song 10','Alpha song 2'].map((title,i)=>{
 const id=`80000000-0000-4000-8000-${String(212+i).padStart(12,'0')}`;
 const assetId=`81000000-0000-4000-8000-${String(212+i).padStart(12,'0')}`;
 return {id,recordingId:id,title,artists:[['Beta voice','Zulu voice','Alpha voice'][i]],albumTitle:'An exceptionally long album name to exercise constrained mobile layouts',coverUrl:null,durationMs:[120000,30000,60000][i],versionLabel:'Original recording',addedAt:['2026-01-01T00:00:00.000Z','2026-03-01T00:00:00.000Z','2026-02-01T00:00:00.000Z'][i],reference:{provider:'deezer',id:String(212+i)},references:[{provider:'deezer',id:String(212+i)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:18000,url:`https://res.cloudinary.com/responsive-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const fixtureId='90000000-0000-4000-8000-000000000213';
const report={checkedAt:new Date().toISOString(),scope:'Real app; intercepted synthetic APIs, generated local audio, no database writes',checks:[],pageErrors:[]};
const output='.local/responsive-collections';
let browser, latestPage;

async function createFixture(theme='light',width=320){
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,isMobile:width<700,hasTouch:width<700,serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.responsiveAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
 const settings={theme,audioTechnology:'none',audioQuality:'balanced',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.4,shuffle:false,repeat:'off',bloomPerformance:'auto'};
 let session=null;
 async function audio(route){const match=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!match)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Length':String(wav.length)}});const start=Number(match[1]),end=match[2]?Math.min(wav.length-1,Number(match[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
 await context.route('https://res.cloudinary.com/responsive-fixture/**',audio);
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return audio(route);
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings'){if(request.method()==='PATCH')Object.assign(settings,request.postDataJSON());return route.fulfill({json:settings});}
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:tracks}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/search')return route.fulfill({json:{tracks,artists:[],albums:[],totals:{tracks:3},nextCursors:{tracks:null}}});
  if(path==='/api/v2/mixes')return route.fulfill({json:{mixes:[{id:fixtureId,name:'A responsive mix',status:'ready',slot:'favorites',trackCount:3,description:'Synthetic collection'}]}});
  if(/^\/api\/v2\/(playlists|mixes|albums|artists)\/[^/]+$/.test(path))return route.fulfill({json:{id:fixtureId,name:'A responsive collection',title:'A responsive collection',description:'Synthetic collection',recordings:tracks,tracks,albums:[],playability:'ready'}});
  if(path==='/api/v2/import')return route.fulfill({json:{name:'Imported responsive collection',tracks,recordings:tracks}});
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   return route.fulfill({json:{session,serverTime:Date.now()}});
  }
  if(path==='/api/v2/recordings/resolve'){const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
  if(path==='/api/v2/lyrics')return route.fulfill({json:{lines:[],timing:'plain',schemaVersion:'verified-lyrics-v1'}});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]}});
  return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
 });
 const page=await context.newPage();latestPage=page;page.setDefaultTimeout(25000);
 page.on('pageerror',error=>report.pageErrors.push(theme+'/'+width+': '+error.message));
 return {context,page};
}

async function navigate(page,path){
 report.stage='Navigating '+path;console.log(report.stage);
 await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:90000});
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await expect(page.locator('#music-main main')).toBeVisible();
}
async function assertFits(page,label,settings=false){
 const result=await page.evaluate(settings=>{
  const stage=document.querySelector('#music-main'),main=stage?.querySelector('main');
  const overflowing=[...document.querySelectorAll(settings?'#music-main main section, #music-main main section button, #music-main main section select, #music-main main section fieldset, #music-main main section input[type="range"]':'[data-track-layout], [data-song-id], [aria-label="Sort songs"], [aria-label="Reverse sort order"], [aria-label="Collection layout"]')].filter(element=>{
   const rect=element.getBoundingClientRect();return rect.width>0&&(rect.left<-.5||rect.right>innerWidth+.5);
  }).map(element=>({tag:element.tagName,label:element.getAttribute('aria-label')||element.textContent?.trim().slice(0,75),bounds:element.getBoundingClientRect().toJSON()}));
  return {viewport:innerWidth,document:document.documentElement.scrollWidth,stage:stage&&{client:stage.clientWidth,scroll:stage.scrollWidth},main:main&&{client:main.clientWidth,scroll:main.scrollWidth},overflowing};
 },settings);
 assert.ok(result.document<=result.viewport+1,label+' document overflow: '+JSON.stringify(result));
 assert.ok(result.stage.scroll<=result.stage.client+1,label+' scrolling stage overflow: '+JSON.stringify(result));
 assert.ok(result.main.scroll<=result.main.client+1,label+' main content overflow: '+JSON.stringify(result));
 assert.deepEqual(result.overflowing,[],label+' controls/rows fit viewport');
}
async function settingsChecks(){
 for(const theme of ['light','dark']){
  const {context,page}=await createFixture(theme);
  try{
   await navigate(page,'/settings');await expect(page.getByRole('heading',{name:'Audio technology',exact:true})).toBeVisible().catch(async error=>{report.pageState={url:page.url(),text:await page.locator('body').innerText()};await page.screenshot({path:output+'/settings-failure.png'});throw error;});
   for(const width of [280,320,360,390,768,1440]){
    console.log(`Checking settings ${theme} ${width}px`);await page.setViewportSize({width,height:900});
    await assertFits(page,`settings ${theme} ${width}px`,true);
    await page.getByRole('combobox',{name:'Streaming data',exact:true}).selectOption('high');
    await expect(page.getByRole('combobox',{name:'Streaming data',exact:true})).toHaveValue('high');
    await page.getByRole('combobox',{name:'Bloom performance',exact:true}).selectOption('5');
    await expect(page.getByRole('combobox',{name:'Bloom performance',exact:true})).toHaveValue('5');
    await assertFits(page,`settings ${theme} ${width}px highest Bloom / smooth playback`,true);
    if(width<=320){for(const radio of await page.getByRole('radio').all()){await radio.check();await expect(radio).toBeChecked();await assertFits(page,`settings ${theme} ${width}px audio ${await radio.inputValue()}`,true);}}
    if(width===280||width===320||width===1440)await page.screenshot({path:`${output}/settings-${theme}-${width}.png`,fullPage:true});
    report.checks.push(`Settings ${theme} ${width}px: no document/stage/content overflow; audio presets and selects remain usable`);
   }
  }finally{await context.close();}
 }
}
async function seedDownloads(page){
 await page.evaluate(async input=>{
  const bytes=Uint8Array.from(atob(input.audio),character=>character.charCodeAt(0));
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-ink-v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('entries'))request.result.createObjectStore('entries');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');for(const track of input.tracks)tx.objectStore('entries').put({track,blob:new Blob([bytes],{type:'audio/wav'}),sizeBytes:bytes.length,sha256:input.sha,savedAt:Date.parse(track.addedAt),requested:true},`account:${input.accountId}:audio:${track.id}`);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 },{accountId:account.id,tracks,audio:wav.toString('base64'),sha});
}
const ids=indices=>indices.map(index=>tracks[index].id);
async function rowIds(list){return list.locator('[data-song-id]').evaluateAll(rows=>rows.map(row=>row.dataset.songId));}
async function collectionChecks(){
 const variants=[{theme:'light',width:320,full:true},{theme:'dark',width:390,full:false},{theme:'light',width:1440,full:false}];
 for(const {theme,width,full} of variants){
  const {context,page}=await createFixture(theme,width);
  try{
   await navigate(page,'/settings');await expect(page.getByRole('heading',{name:'Audio technology',exact:true})).toBeVisible();await seedDownloads(page);
   const routes=full?['/home','/search?q=responsive','/discover','/library','/liked',`/playlist/${fixtureId}`,`/mix/${fixtureId}`,`/album/${fixtureId}`,`/artist/${fixtureId}`,'/import','/library/downloaded']:['/library','/liked',`/playlist/${fixtureId}`,'/library/downloaded'];
   for(const path of routes){
    console.log(`Checking collections ${theme} ${width}px ${path}`);await navigate(page,path);
    if(path==='/import'){await page.getByRole('textbox',{name:'Playlist link',exact:true}).fill('https://open.spotify.com/playlist/responsive');await page.getByRole('button',{name:'Preview playlist',exact:true}).click();}
    const lists=page.locator('[data-track-layout]'),count=path==='/home'?2:1;await expect(lists).toHaveCount(count);await expect(lists.first()).toBeVisible();
    const sorts=page.getByRole('combobox',{name:'Sort songs',exact:true}),reverses=page.getByRole('button',{name:'Reverse sort order',exact:true});
    await expect(sorts).toHaveCount(count);await expect(reverses).toHaveCount(count);
    for(let i=0;i<count;i++){
     const list=lists.nth(i),sort=sorts.nth(i),reverse=reverses.nth(i);
     await expect(list.locator('[data-song-id]')).toHaveCount(3);
     for(const layout of ['list','cards','compact']){
      await page.getByRole('button',{name:layout[0].toUpperCase()+layout.slice(1)+' layout',exact:true}).nth(i).click();await expect(list).toHaveAttribute('data-track-layout',layout);await assertFits(page,`${theme} ${width}px ${path} ${layout}`);
     }
     for(const [value,expected] of [['kept',ids([0,1,2])],['title',ids([2,1,0])],['artist',ids([2,0,1])],['duration',ids([1,2,0])]]){
      if(await reverse.getAttribute('aria-pressed')==='true')await reverse.click();
      await sort.selectOption(value);await expect.poll(()=>rowIds(list)).toEqual(expected);
      await reverse.click();await expect(reverse).toHaveAttribute('aria-pressed','true');await expect.poll(()=>rowIds(list)).toEqual([...expected].reverse());
      await reverse.click();await expect.poll(()=>rowIds(list)).toEqual(expected);
     }
     const hasDate=await sort.locator('option[value="added"]').count();
     if(path==='/library'||path==='/liked'||path.startsWith('/playlist/')||path==='/library/downloaded')assert.equal(hasDate,1,path+' exposes date sorting');
     if(hasDate){await sort.selectOption('added');await expect.poll(()=>rowIds(list)).toEqual(ids([1,2,0]));await expect(list.locator('time')).toHaveCount(3);assert.deepEqual(await list.locator('time').evaluateAll(times=>times.map(time=>time.dateTime)),[1,2,0].map(index=>tracks[index].addedAt),path+' displays the actual saved timestamps');await reverse.click();await expect.poll(()=>rowIds(list)).toEqual(ids([0,2,1]));await reverse.click();}
     await sort.selectOption('kept');await page.getByRole('button',{name:'Cards layout',exact:true}).nth(i).click();
    }
    await assertFits(page,`${theme} ${width}px ${path} final`);
    if(path==='/library'||path.startsWith('/playlist/'))await page.screenshot({path:`${output}/collection-${theme}-${width}-${path.split('/')[1]}.png`});
    if(path!=='/import'){
     await page.reload({waitUntil:'domcontentloaded'});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
     for(let i=0;i<count;i++)await expect(page.locator('[data-track-layout]').nth(i)).toHaveAttribute('data-track-layout','cards');
    }
    report.checks.push(`${theme} ${width}px ${path}: ${count} list(s), all layouts, title/artist/duration/original sort and reversal, ${path==='/import'?'preview':'reload persistence'}${hasDateLabel(path)}`);
   }
  }finally{await context.close();}
 }
}
function hasDateLabel(path){return path==='/library'||path==='/liked'||path.startsWith('/playlist/')||path==='/library/downloaded'?', real-date sorting':'';}

async function playbackChecks(){
 const {context,page}=await createFixture('light',320);
 try{
  await navigate(page,'/settings');await expect(page.getByRole('heading',{name:'Audio technology',exact:true})).toBeVisible();await seedDownloads(page);
  await navigate(page,`/playlist/${fixtureId}`);const list=page.locator('[data-track-layout]');await expect(list).toBeVisible();
  await page.getByRole('combobox',{name:'Sort songs',exact:true}).selectOption('artist');await expect.poll(()=>rowIds(list)).toEqual(ids([2,0,1]));
  await page.getByRole('button',{name:'Play playlist',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[2].title);
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();const player=page.getByRole('dialog');await expect(player).toBeVisible();
  await player.getByRole('button',{name:'Next song',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[0].title);
  await player.getByRole('button',{name:'Next song',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[1].title);
  await player.getByRole('button',{name:'Close',exact:true}).click();
  const reverse=page.getByRole('button',{name:'Reverse sort order',exact:true});await reverse.click();await expect.poll(()=>rowIds(list)).toEqual(ids([1,0,2]));
  await page.getByRole('button',{name:'Play playlist',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[1].title);
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Next song',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[0].title);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await reverse.click();await expect.poll(()=>rowIds(list)).toEqual(ids([2,0,1]));
  await page.getByRole('button',{name:'Play playlist',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[2].title);
  await list.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[0].title);
  await list.getByRole('button',{name:'Pause '+tracks[0].title,exact:true}).click();await expect(list.getByRole('button',{name:'Play '+tracks[0].title,exact:true})).toBeVisible();
  await reverse.click();await expect.poll(()=>rowIds(list)).toEqual(ids([1,0,2]));
  await list.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).click();await expect(list.getByRole('button',{name:'Pause '+tracks[0].title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Next song',exact:true}).click();await expect(page.locator('[aria-label="Open now playing"] b')).toHaveText(tracks[2].title);
  report.checks.push('Playlist hero play and next-song queue follow artist sorting and its reversed order on mobile');
  report.checks.push('Pausing a current row, reversing the displayed order, and resuming that row rebuilds the upcoming queue in the new order');
 }finally{await context.close();}
}

try{
 await fs.mkdir(output,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true});
 if(process.argv.includes('--playback-only'))await playbackChecks();
 else{if(!process.argv.includes('--routes-only'))await settingsChecks();if(!process.argv.includes('--settings-only')){await collectionChecks();await playbackChecks();}}
 assert.deepEqual(report.pageErrors,[],'No client runtime errors');
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(latestPage&&!latestPage.isClosed())await latestPage.screenshot({path:output+'/failure.png'}).catch(()=>{});}
finally{await browser?.close();await fs.mkdir(output,{recursive:true});const suffix=process.argv.includes('--settings-only')?'-settings':process.argv.includes('--routes-only')?'-routes':process.argv.includes('--playback-only')?'-playback':'';await fs.writeFile(output+'/report'+suffix+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
