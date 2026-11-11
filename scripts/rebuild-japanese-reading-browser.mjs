/** Real Sakura UI with synthetic Japanese songs, local audio, and intercepted mutations. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL || 'http://localhost:3001';
const secret=process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'94000000-0000-4000-8000-000000000401',username:'Reading fixture',email:'readings@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const samples=8000*40,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*330/8000)*800),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['君の声','未来の光','花の記憶'].map((title,index)=>{
 const id=`95000000-0000-4000-8000-${String(index+401).padStart(12,'0')}`,assetId=`96000000-0000-4000-8000-${String(index+401).padStart(12,'0')}`;
 return {id,title,artists:['Sakura fixture'],artistId:null,albumId:null,albumTitle:'A handwritten song',durationMs:40000,coverUrl:`/reading-cover-${index}.svg`,versionLabel:'Original recording',reference:{provider:'deezer',id:String(index+401)},references:[{provider:'deezer',id:String(index+401)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:40000,url:`https://res.cloudinary.com/reading-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const sourceLines=tracks.map(track=>[{text:track.title,start:0,end:30},{text:'風に乗せて',start:30,end:40}]);
const readings={'君の声':'kimi no koe','未来の光':'mirai no hikari','花の記憶':'hana no kioku','風に乗せて':'kaze ni nosete'};
const desktopHeaderOnly=process.argv.includes('--desktop-header');
const viewportOnly=process.argv.includes('--viewport')||desktopHeaderOnly;
const miniArtworkOnly=process.argv.includes('--mini-artwork');
const output=miniArtworkOnly?'.local/mini-player-artwork':desktopHeaderOnly?'.local/mobile-player-header':viewportOnly?'.local/mobile-player-viewport':'.local/japanese-reading';
const report={checkedAt:new Date().toISOString(),scope:'Real app; synthetic songs, local generated audio, intercepted account mutations; no provider/account writes',checks:[],errors:[]};
let browser,latestPage;

async function room(theme,width,sharedSettings,height=900){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700,colorScheme:theme,serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.readingFixtureAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
 const settings=sharedSettings||{theme,audioTechnology:'none',japaneseReading:false,audioQuality:'balanced',privateSession:true,reducedMotion:false,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.4,shuffle:false,repeat:'off',revision:1,fieldRevisions:{}};
 const counts={readings:0,lyrics:0,patches:0};
 let session=null;
 const serveAudio=route=>{const match=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!match)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Length':String(wav.length)}});const start=Number(match[1]),end=match[2]?Math.min(wav.length-1,Number(match[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});};
 await context.route('https://res.cloudinary.com/reading-fixture/**',serveAudio);
 await context.route('**/reading-cover-*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="#d8ba9f"/><stop offset="1" stop-color="#71867f"/></linearGradient></defs><rect width="600" height="600" fill="url(#paper)"/><circle cx="420" cy="145" r="60" fill="#f5e5c9" opacity=".6"/><path d="M0 425Q130 295 240 385T600 345V600H0Z" fill="#5f7770"/><path d="M0 500Q130 375 310 430T600 390V600H0Z" fill="#3c5954"/><path d="M250 610Q288 423 371 200m-66 179q-80-44-75-110 68 10 81 74m20-61q-4-69 44-117 19 64-26 103" fill="none" stroke="#e3c2a9" stroke-width="5"/><text x="45" y="74" fill="#f3ebda" font-size="34" font-family="Georgia" font-style="italic">a handwritten song.</text></svg>'}));
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return serveAudio(route);
  if(path==='/api/v2/profile')return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/settings'){
   if(request.method()==='PATCH'){counts.patches++;const patch=request.postDataJSON();delete patch.expectedRevision;Object.assign(settings,patch);settings.revision++;for(const key of Object.keys(patch))settings.fieldRevisions[key]=settings.revision;}
   return route.fulfill({json:settings});
  }
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:tracks}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   return route.fulfill({json:{session,serverTime:Date.now()}});
  }
  if(path==='/api/v2/recordings/resolve'){const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,recordingId:track.id,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
  if(path==='/api/v2/lyrics'){counts.lyrics++;const index=Math.max(0,tracks.findIndex(track=>track.title===url.searchParams.get('title')));return route.fulfill({json:{status:'matched',lines:sourceLines[index],timing:'synced',provider:'synthetic Japanese fixture',providerTrackId:401+index,schemaVersion:'verified-lyrics-v3'}});}
  if(path==='/api/v2/readings'){counts.readings++;const data=request.postDataJSON();return route.fulfill({json:{engine:'ja-ipadic-hepburn-v1',lines:data.lines.map(line=>({...line,romanized:readings[line.text],readingReviewNeeded:false,readingEngine:'ja-ipadic-hepburn-v1'}))}});}
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]}});
  return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
 });
 const page=await context.newPage();latestPage=page;page.on('pageerror',error=>report.errors.push(`${theme}/${width}: ${error.message}`));
 return {context,page,settings,counts};
}

async function openPlayer(page){
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();
 const dialog=page.locator('dialog[data-dialog-appearance="player"]');
 await expect(dialog).toHaveAttribute('data-dialog-phase','open');
 return dialog;
}
async function pausePlayer(dialog){
 const pause=dialog.getByRole('button',{name:'Pause',exact:true});
 await expect(pause).toBeVisible();
 await pause.click();
 await expect(dialog.getByRole('button',{name:'Play',exact:true})).toBeVisible();
}
async function drag(page,dialog,direction,mobile){
 const art=dialog.getByRole('group',{name:/Artwork for/});await art.scrollIntoViewIfNeeded();
 const rect=await art.boundingBox(),x=rect.x+rect.width*.5,y=rect.y+rect.height*.5,delta=direction==='next'?-130:130;
 if(mobile){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+delta*i/12,y:y+2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta,y+2,{steps:14});await page.mouse.up();}
}
async function testRoom(theme,width,full){
 const {context,page,settings,counts}=await room(theme,width);
 try{
  await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.getByRole('button',{name:'Play 君の声',exact:true}).click();
  let dialog=await openPlayer(page);
  await pausePlayer(dialog);
  await expect(dialog.getByRole('heading',{name:'君の声',exact:true})).toBeVisible();
  await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Japanese reading guide',exact:true}).click();
  await expect(dialog.locator('[data-player-reading]')).toHaveText('kimi no koe');
  await expect.poll(()=>settings.japaneseReading).toBe(true);
  assert.equal(counts.readings,1,'Mini/full lyric subscriptions share one dictionary request.');
  await page.screenshot({path:`${output}/player-${theme}-${width}.png`});
  const overflow=await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1);
  assert.equal(overflow,false,'The full-player layout fits the viewport.');
  await drag(page,dialog,'next',width<700);
  await expect(dialog.getByRole('heading',{name:'未来の光',exact:true})).toBeVisible();
  await pausePlayer(dialog);
  await expect(dialog.locator('[data-player-reading]')).toHaveText('mirai no hikari');
  assert.equal(counts.readings,2,'The next Japanese song automatically receives its saved reading choice.');
  report.checks.push(`${theme}/${width}: Japanese reading auto-prepares after ${width<700?'touch swipe':'mouse drag'}; artwork transitions and lettering fit; single shared reading request per song.`);
  if(full){
   await dialog.getByRole('button',{name:'Open lyrics',exact:true}).click();
   const words=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(words).toHaveAttribute('data-dialog-phase','open');
   assert.equal(await words.locator('[data-lyrics-controls]').evaluate(element=>getComputedStyle(element).backgroundColor),await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'Lyric playback controls match the page background');
   await expect(words.getByRole('button',{name:'Japanese reading guide',exact:true})).toHaveAttribute('aria-pressed','true');
   await expect(words.getByText('mirai no hikari',{exact:true})).toBeVisible();
   await words.getByRole('button',{name:'Close',exact:true}).click();await expect(words).toHaveCount(0);
   // Closing the lyric overlay reveals its existing player underlay.
   await expect(dialog).toHaveAttribute('data-dialog-phase','open');
   await expect(dialog.locator('[data-player-reading]')).toHaveText('mirai no hikari');
   await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
   await page.reload({waitUntil:'domcontentloaded',timeout:90000});
   await page.getByRole('button',{name:'Play 君の声',exact:true}).click();
   dialog=await openPlayer(page);await pausePlayer(dialog);await expect(dialog.locator('[data-player-reading]')).toHaveText('kimi no koe');
   const secondDevice=await room(theme,width,settings);
   try{
    await secondDevice.page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
    await secondDevice.page.getByRole('button',{name:'Play 君の声',exact:true}).click();
    const remotePlayer=await openPlayer(secondDevice.page);await pausePlayer(remotePlayer);
    await expect(remotePlayer.locator('[data-player-reading]')).toHaveText('kimi no koe');
    assert.equal(secondDevice.counts.patches,0,'A fresh device reads the saved account preference without resaving it.');
   }finally{await secondDevice.context.close();}
   report.checks.push('A fresh browser device with empty local storage inherits the saved Japanese-reading preference from its account.');
   await dialog.getByRole('button',{name:'Japanese reading guide',exact:true}).click();
   await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);await expect.poll(()=>settings.japaneseReading).toBe(false);
   await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
   await page.reload({waitUntil:'domcontentloaded',timeout:90000});
   await page.getByRole('button',{name:'Play 君の声',exact:true}).click();dialog=await openPlayer(page);
   await pausePlayer(dialog);
   await expect(dialog.getByRole('button',{name:'Japanese reading guide',exact:true})).toHaveAttribute('aria-pressed','false');
   await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
   report.checks.push('Japanese reading remains enabled across lyric/full-player close/reopen and reload, and an explicit disable remains disabled after reload.');
   for(const track of tracks.slice(1)){
    await dialog.getByRole('button',{name:'Next song',exact:true}).click();
    await expect(dialog.getByRole('heading',{name:track.title,exact:true})).toBeVisible();
    await pausePlayer(dialog);
    await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
   }
   let pendingReading;
   const holdReading=route=>{pendingReading=route;};
   await context.route('**/api/v2/readings',holdReading);
   const readingToggle=dialog.getByRole('button',{name:'Japanese reading guide',exact:true});
   await readingToggle.click();
   await expect.poll(()=>Boolean(pendingReading)).toBe(true);
   await expect(readingToggle).toHaveAttribute('aria-busy','true');
   await readingToggle.click();
   await expect(readingToggle).toHaveAttribute('aria-pressed','false');
   const readingResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/readings');
   const body=pendingReading.request().postDataJSON();
   await pendingReading.fulfill({json:{engine:'ja-ipadic-hepburn-v1',lines:body.lines.map(line=>({...line,romanized:readings[line.text],readingReviewNeeded:false,readingEngine:'ja-ipadic-hepburn-v1'}))}});
   await (await readingResponse).finished();
   await context.unroute('**/api/v2/readings',holdReading);
   await expect(readingToggle).toHaveAttribute('aria-pressed','false');
   await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
   await expect.poll(()=>settings.japaneseReading).toBe(false);
   await readingToggle.click();
   await expect(dialog.locator('[data-player-reading]')).toHaveText('hana no kioku');
   report.checks.push('An explicit disable stays off on later songs and during a slow dictionary response; re-enabling uses the completed reading.');
  }
  if(width<700){
   const header=dialog.locator('[data-dialog-swipe-handle]');const box=await header.boundingBox();assert.ok(box);
   const cdp=await context.newCDPSession(page),x=box.x+box.width*.5,y=box.y+12;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+step*18}]});await page.waitForTimeout(20);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   await expect(dialog).toHaveCount(0);
  }else{await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);}
  await page.getByRole('button',{name:'Play 君の声',exact:true}).click();
  const mini=page.locator('[data-song-swipe="mini"]');await expect(mini.locator('b')).toHaveText('君の声');
  const box=await mini.boundingBox();assert.ok(box);const x=box.x+box.width*.65,y=box.y+box.height*.35;
  if(width<700){
   const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*10,y:y+2}]});await page.waitForTimeout(20);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-110,y+2,{steps:12});await page.mouse.up();}
  await expect(mini.locator('b')).toHaveText('未来の光');await expect(page.locator('dialog[data-dialog-appearance="player"]')).toHaveCount(0);
  report.checks.push(`${theme}/${width}: ${width<700?'native pull dismisses full player; touch swipe':'mouse drag'} changes mini-player song without opening its dialog.`);
 }catch(error){report.pageState={url:page.url(),text:(await page.locator('body').innerText()).slice(0,5000)};await page.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}finally{await context.close();}
}

async function testMiniArtwork(theme,width){
 const {context,page}=await room(theme,width);
 const keyWarnings=[];
 page.on('console',message=>{if(/same key|unique.*key/i.test(message.text()))keyWarnings.push(message.text());});
 try{
  await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  const mini=page.locator('[data-song-swipe="mini"]');
  for(const index of [0,1,2,0,2,1,0,1,2]){
   const track=tracks[index];
   await page.getByRole('button',{name:`Play ${track.title}`,exact:true}).click();
   await expect(mini.locator('b')).toHaveCount(1);
   await expect(mini.locator('b')).toHaveText(track.title);
   const cover=mini.getByRole('button',{name:'Open now playing',exact:true}).locator('img');
   await expect(cover).toHaveCount(1);
   await expect(cover).toHaveAttribute('src',track.coverUrl);
   await expect.poll(()=>cover.evaluate(element=>element.complete&&element.naturalWidth>0)).toBe(true);
  }
  assert.deepEqual(keyWarnings,[],'Current artwork and caption never share duplicate React keys');
  await page.screenshot({path:`${output}/${theme}-${width}.png`,animations:'disabled'});
  report.checks.push(`${theme}/${width}: nine song changes retain exactly one current mini-player cover and caption, with no duplicate-key warnings`);
 }finally{await context.close();}
}

async function testViewport(theme,width,height,longTitle=false){
 const originalTitle=tracks[0].title;
 if(longTitle)tracks[0].title='君の声 — A song for the long way home, with a very long handwritten title';
 const {context,page}=await room(theme,width,undefined,height);
 const visibleInViewport=async(locator,label)=>{
  const bounds=await locator.boundingBox();assert.ok(bounds,`${label} has bounds`);
  assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height+1,`${label} stays in the first ${height}px viewport: ${JSON.stringify(bounds)}`);
 };
 try{
  await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.getByRole('button',{name:`Play ${tracks[0].title}`,exact:true}).click();
  const dialog=await openPlayer(page);await pausePlayer(dialog);
  const header=dialog.locator('[data-dialog-swipe-handle]');
  if(width<=760){
   await expect(header.getByRole('button',{name:'Close',exact:true})).toBeHidden();
   const title=await header.getByRole('heading').boundingBox();assert.ok(Math.abs(title.x+title.width/2-width/2)<1,'Mobile heading is centered');
   assert.ok((await header.boundingBox()).height<=70,'Player header stays minimal');
  }
  const artwork=dialog.getByRole('group',{name:/Artwork for/});await visibleInViewport(artwork,'Cover artwork');
  const coverBounds=await artwork.boundingBox();assert.ok(coverBounds.width>=100&&coverBounds.height>=100,'Cover stays visible at a useful size');
  for(const label of ['Previous song','Next song','Share this song'])await visibleInViewport(dialog.getByRole('button',{name:label,exact:true}),label);
  await visibleInViewport(dialog.getByRole('button',{name:/^Repeat:/}),'Repeat');
  await visibleInViewport(dialog.getByRole('button',{name:'Play',exact:true}),'Play');
  await visibleInViewport(dialog.getByRole('slider',{name:'Playback position',exact:true}),'Seek');
  assert.equal(await dialog.locator('[data-player-scroll]').evaluate(element=>element.scrollTop),0,'Essential controls need no scrolling');
  assert.equal(await dialog.evaluate(element=>element.scrollWidth>element.clientWidth+1),false,'No horizontal overflow');
  await page.screenshot({path:`${output}/player-${theme}-${width}-${height}${longTitle?'-long':''}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Lyrics',exact:true}).click();
  const words=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(words).toHaveAttribute('data-dialog-phase','open');
  await expect(words.locator('[data-player-header-song]')).toHaveText(tracks[0].title);
  await visibleInViewport(words.locator('[data-player-header-song]'),'Lyrics song identity');
  if(width<=760){
   await expect(words.locator('[data-dialog-swipe-handle]').getByRole('button',{name:'Close',exact:true})).toBeHidden();
   assert.ok((await words.locator('[data-dialog-swipe-handle]').boundingBox()).height<=85,'Lyrics header stays minimal with song title');
  }else{
   // Exercise the actual desktop header's layout with exceptionally long
   // metadata; its text must shrink without pushing Close out of view.
   await words.locator('[data-player-header-song]').evaluate(element=>{element.textContent=element.textContent.repeat(60);});
   const bounds=await words.locator('[data-dialog-swipe-handle]').evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth}));
   assert.ok(bounds.scroll<=bounds.client+1,'A long desktop song name cannot overflow the header');
   await visibleInViewport(words.getByRole('button',{name:'Close',exact:true}),'Desktop Close');
   const closeBounds=await words.getByRole('button',{name:'Close',exact:true}).boundingBox();assert.ok(closeBounds.x+closeBounds.width<=width,'Desktop Close stays onscreen');
  }
  await visibleInViewport(words.locator('[data-lyrics-controls]'),'Lyrics transport');
  await words.getByRole('button',{name:'Next song',exact:true}).click();
  await expect(words.locator('[data-player-header-song]')).toHaveText(tracks[1].title);
  await page.screenshot({path:`${output}/lyrics-${theme}-${width}-${height}${longTitle?'-long':''}.png`,animations:'disabled'});
  if(width<=760){
   const bounds=await words.locator('[data-dialog-swipe-handle]').boundingBox(),cdp=await context.newCDPSession(page),x=bounds.x+bounds.width/2,y=bounds.y+12;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+step*18}]});await page.waitForTimeout(20);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   await expect(words).toHaveCount(0);await expect(dialog).toHaveAttribute('data-dialog-phase','open');
  }else{await expect(words.getByRole('button',{name:'Close',exact:true})).toBeVisible();await words.getByRole('button',{name:'Close',exact:true}).click();}
  report.checks.push(`${theme}/${width}×${height}${longTitle?' long title':''}: cover, seek, playback and sharing fit first screen; compact headers, live lyrics title, transport and dismissal work`);
 }catch(error){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}
 finally{tracks[0].title=originalTitle;await context.close();}
}

try{
 await fs.mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 if(miniArtworkOnly)for(const theme of ['light','dark'])for(const width of [1440,390])await testMiniArtwork(theme,width);
 else if(desktopHeaderOnly)await testViewport('dark',1440,900);
 else if(viewportOnly){
  for(const theme of ['light','dark'])for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375]])await testViewport(theme,width,height);
  await testViewport('light',320,568,true);await testViewport('dark',1440,900);
 }else for(const theme of ['light','dark'])for(const width of [1440,390])await testRoom(theme,width,theme==='light'&&width===1440);
 assert.deepEqual(report.errors,[]);
 await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=error.message;if(latestPage&&!latestPage.isClosed())await latestPage.screenshot({path:output+'/failure.png'}).catch(()=>{});await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();}
