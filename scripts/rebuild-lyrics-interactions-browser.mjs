/** Real Sakura UI with synthetic multilingual songs, local audio, and intercepted mutations. Run with node --import tsx. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';
import {romanizeLyricLines} from '../src/rebuild/lyrics/readings.ts';
import {readingEngine} from '../src/rebuild/lyrics/language.ts';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL || 'http://localhost:3000';
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
const output=miniArtworkOnly?'.local/mini-player-artwork':desktopHeaderOnly?'.local/mobile-player-header':viewportOnly?'.local/mobile-player-viewport':'.local/lyrics-interactions-browser';
const report={checkedAt:new Date().toISOString(),scope:'Real app; synthetic songs, local generated audio, intercepted account mutations; no provider/account writes',checks:[],errors:[]};
let browser;

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
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(`${theme}/${width}: ${error.message}`));
 return {context,page,settings,counts};
}

const fourth={...tracks[0],id:'95000000-0000-4000-8000-000000000404',title:'Unpublished fixture',reference:{provider:'deezer',id:'404'},references:[{provider:'deezer',id:'404'}]};
tracks.push(fourth);
Object.assign(tracks[0],{title:'中国的歌',artists:['Fixture singer'],artistCredits:[{name:'Fixture singer',role:'primary'},{name:'Beyoncé',role:'featured'}],albumId:'deezer:800',albumTitle:'蓝色 Album'});
Object.assign(tracks[1],{title:'한국의 노래',artists:['Korean fixture'],albumId:'deezer:801',albumTitle:'Second album'});
Object.assign(tracks[2],{albumId:'deezer:802'});
for(let index=0;index<tracks.length;index++)tracks[index].coverUrl=`${base}/reading-cover-${index}.svg`;
sourceLines[0]=[{text:'你好中国 Hello',start:1,end:10},{text:'月亮代表我的心',start:20,end:38}];
sourceLines[1]=[{text:'보고 싶다 한국어',start:1,end:20},{text:'Hello 봄날',start:20,end:38}];
sourceLines.push([]);
let publications=0,feedbacks=[];
async function setup(width){
  const fixture=await room('light',width),{context,counts}=fixture;
  counts.pages=0;
  await context.route('**/api/v2/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/v2/library'){
      counts.pages++;
      return route.fulfill({json:{recordings:url.searchParams.has('cursor')?tracks.slice(1):tracks.slice(0,1),playlists:[],nextCursor:url.searchParams.has('cursor')?null:'next-members'}});
    }
    if(path==='/api/v2/lyrics'){
      const index=tracks.findIndex(track=>track.title===url.searchParams.get('title'));counts.lyrics++;
      if(index===3)return route.fulfill({status:404,json:{status:'missing',reason:'No lyrics in fixture'}});
      return route.fulfill({json:{lines:sourceLines[index],timing:'synced',provider:'multilingual fixture',providerTrackId:index+1,schemaVersion:'verified-lyrics-v3'}});
    }
    if(path==='/api/v2/readings'){
      counts.readings++;const body=request.postDataJSON(),lines=await romanizeLyricLines(body.lines,body.language);
      return route.fulfill({json:{engine:readingEngine(body.language),lines}});
    }
    if(path==='/api/v2/lyrics/challenge')return route.fulfill({json:{prefix:'lyrics-fixture',target:'f'.repeat(64),expiresAt:Date.now()+240000}});
    if(path==='/api/v2/lyrics/publish'){
      publications++;assert.equal(request.postDataJSON().recordingId,tracks[3].id);
      return route.fulfill({status:201,json:{published:true,lyrics:{lines:[{text:'Freshly published words',start:0}],timing:'plain',provider:'lrclib',providerTrackId:400,schemaVersion:'verified-lyrics-v3'}}});
    }
    if(path==='/api/v2/taste'&&request.method()==='POST'){
      feedbacks.push(request.postDataJSON());return route.fulfill({json:{updatedAt:new Date().toISOString()}});
    }
    if(path.startsWith('/api/v2/mixes/')){
      const members=counts.coverMode==='empty'?tracks.map(track=>({...track,coverUrl:null})):counts.coverMode==='broken'?tracks.map((track,index)=>index?track:{...track,coverUrl:base+'/broken-collection-cover.svg'}):tracks;
      return route.fulfill({json:{id:'mix-fixture',name:'Fixture mix',recordings:members,coverUrls:members.map(track=>track.coverUrl),status:'ready',playability:'resolvable'}});
    }
    if(path.startsWith('/api/v2/albums/'))return route.fulfill({json:{id:path.split('/').at(-1),title:'Verified album page',recordings:[tracks[0]],coverUrl:tracks[0].coverUrl}});
    if(path.startsWith('/api/v2/playlists/'))return route.fulfill({json:{name:'Fixture playlist',recordings:tracks,hasCustomCover:true,coverUrl:tracks[2].coverUrl,coverUrls:tracks.map(track=>track.coverUrl)}});
    return route.fallback();
  });
  await context.route('**/broken-collection-cover.svg',route=>route.fulfill({status:404,body:'missing image'}));
  return fixture;
}
async function run(width){
  const {context,page,settings,counts}=await setup(width);
  try{
    await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
    const search=page.getByRole('searchbox',{name:'Find a liked song'});
    await search.fill('SECOND album');
    await expect(page.getByRole('button',{name:`Play ${tracks[1].title}`,exact:true})).toBeVisible();
    assert.ok(counts.pages>=2,'Artist/album search exhausts membership pages');
    await search.fill('蓝色 beyonce');await expect(page.getByRole('button',{name:`Play ${tracks[0].title}`,exact:true})).toBeVisible();
    await search.fill('');
    const album=page.locator('[data-track-layout] [data-album-link]').filter({hasText:'蓝色 Album'}).filter({visible:true}).first();
    if(width>=700){await expect(album).toHaveAttribute('href','/album/deezer%3A800');}
    await page.getByRole('button',{name:`Play ${tracks[0].title}`,exact:true}).click();
    await page.getByRole('button',{name:'Open now playing',exact:true}).click();
    let player=page.locator('dialog[data-dialog-appearance="player"]');await expect(player).toHaveAttribute('data-dialog-phase','open');
    await player.getByRole('button',{name:'Pause',exact:true}).click();
    await player.getByRole('slider',{name:'Playback position',exact:true}).press('ArrowRight');
    await player.getByRole('button',{name:'Chinese Pinyin',exact:true}).click();
    await expect(player.locator('[data-player-reading]')).toContainText('nǐ hǎo');
    await expect.poll(()=>settings.lyricReading).toBe(true);
    await player.getByRole('button',{name:'Recommendation controls',exact:true}).click();
    const menu=page.getByRole('menu',{name:`Options for ${tracks[0].title}`});await expect(menu).toBeVisible();
    await menu.getByRole('menuitem',{name:'Recommend this song less',exact:true}).click();await expect(menu).toHaveCount(0);
    assert.equal(feedbacks.at(-1).targetId,tracks[0].id);
    await player.getByRole('button',{name:'Lyrics',exact:true}).click();
    let lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
    const line=lyrics.locator('button[data-lyric-index="0"]');if(width<700)await line.tap();else await line.click();
    await expect.poll(()=>page.evaluate(()=>document.activeElement?.getAttribute('data-lyric-index'))).toBe('0');
    await page.keyboard.press('Space');await expect(lyrics.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
    await page.keyboard.press('Space');await expect(lyrics.getByRole('button',{name:'Play',exact:true})).toBeVisible();
    const paused=await page.evaluate(()=>window.readingFixtureAudio.paused);
    await line.evaluate(element=>{
      element.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true,cancelable:true}));
      element.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',isComposing:true,bubbles:true,cancelable:true}));
    });
    assert.equal(await page.evaluate(()=>window.readingFixtureAudio.paused),paused,'Repeated/IME keys cannot toggle playback');
    const volume=settings.volume;await page.keyboard.press('ArrowUp');await expect.poll(()=>settings.volume).toBeGreaterThan(volume);
    await page.keyboard.press('ArrowDown');await expect.poll(()=>settings.volume).toBe(volume);
    const before=await page.evaluate(()=>window.readingFixtureAudio.currentTime);await page.keyboard.press('ArrowRight');await expect.poll(()=>page.evaluate(()=>window.readingFixtureAudio.currentTime)).toBeGreaterThan(before+4.5);
    await page.keyboard.press('ArrowLeft');await expect.poll(()=>page.evaluate(()=>window.readingFixtureAudio.currentTime)).toBeLessThan(before+1);
    await line.press('Enter');await expect.poll(()=>page.evaluate(()=>window.readingFixtureAudio.currentTime)).toBeLessThan(2);
    await page.keyboard.press('m');await page.keyboard.press('s');await page.keyboard.press('r');
    await expect.poll(()=>settings.shuffle).toBe(true);await expect.poll(()=>settings.repeat).toBe('all');
    await page.keyboard.press('s');await expect.poll(()=>settings.shuffle).toBe(false);
    const slider=lyrics.getByRole('slider',{name:'Playback position in lyrics',exact:true});await slider.focus();const pos=await slider.inputValue();await slider.press('ArrowRight');assert.notEqual(await slider.inputValue(),pos);
    await line.focus();await page.keyboard.press('Shift+ArrowRight');await expect(lyrics.locator('[data-player-header-song]')).toHaveText(tracks[1].title);
    await expect(lyrics.getByRole('button',{name:'Korean romanization',exact:true})).toHaveAttribute('aria-pressed','true');await expect(lyrics.locator('button[data-lyric-index="0"] small')).toContainText('bogo');
    await lyrics.locator('button[data-lyric-index="0"]').focus();await page.keyboard.press('Shift+ArrowLeft');await expect(lyrics.locator('[data-player-header-song]')).toHaveText(tracks[0].title);
    await expect(lyrics.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
    await lyrics.getByRole('button',{name:'Pause',exact:true}).click();
    await lyrics.locator('button[data-lyric-index="0"]').focus();await page.keyboard.press('?');
    const help=page.getByRole('dialog',{name:'A few little shortcuts.'});await expect(help).toBeVisible();
    await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.readingFixtureAudio.paused),true,'Help dialog owns its keys');
    await page.keyboard.press('Escape');await expect(help).toHaveCount(0);
    await lyrics.locator('button[data-lyric-index="0"]').focus();await page.keyboard.press('q');await expect(page.locator('dialog[data-dialog-appearance="queue"]')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('dialog[data-dialog-appearance="queue"]')).toHaveCount(0);player=page.locator('dialog[data-dialog-appearance="player"]');await expect(player).toHaveAttribute('data-dialog-phase','open');
    await player.getByRole('button',{name:'Play',exact:true}).focus();await page.keyboard.press('l');lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
    await lyrics.locator('button[data-lyric-index="0"]').focus();await page.keyboard.press('f');await expect(lyrics).toHaveCount(0);
    await player.getByRole('button',{name:'Play',exact:true}).focus();await page.keyboard.press('l');lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
    await expect(lyrics.getByRole('button',{name:'Play',exact:true})).toBeVisible();
    await lyrics.getByRole('button',{name:'Select lines',exact:true}).click();await lyrics.locator('button[data-lyric-index="0"]').click();await page.keyboard.press('Space');await expect(lyrics.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
    await lyrics.getByRole('button',{name:'Pause',exact:true}).click();
    // Album navigation dismisses the lyrics overlay and its full-player underlay.
    await lyrics.getByRole('link',{name:'蓝色 Album',exact:true}).click();await expect(page).toHaveURL(/\/album\/deezer%3A800/);await expect(page.locator('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Verified album page'})).toBeVisible();
    assert.equal(await page.evaluate(()=>window.readingFixtureAudio.paused),true,'Album link did not play a row');
    await page.keyboard.press('Control+k');await expect(page).toHaveURL(/\/search$/);
    await page.goto(base+'/mix/mix-fixture',{waitUntil:'domcontentloaded'});
    const art=page.locator('[role="img"][data-cover-count]');await expect(art).toHaveAttribute('data-cover-count','4');await expect(art.locator('img')).toHaveCount(4);
    await page.getByRole('searchbox',{name:'Find a song in this mix'}).fill('蓝色 beyonce');await expect(page.locator('[data-track-layout]').getByRole('button',{name:`Play ${tracks[0].title}`,exact:true})).toBeVisible();
    counts.coverMode='broken';await page.goto(base+'/mix/broken-fixture',{waitUntil:'domcontentloaded'});await expect(art).toHaveAttribute('data-cover-count','3');await expect(art.locator('img')).toHaveCount(3);
    counts.coverMode='empty';await page.goto(base+'/mix/empty-fixture',{waitUntil:'domcontentloaded'});await expect(art).toHaveAttribute('data-cover-count','0');await expect(art.locator('img')).toHaveCount(0);
    await page.goto(base+'/playlist/fixture',{waitUntil:'domcontentloaded'});await expect(page.locator('[role="img"][data-cover-count]')).toHaveAttribute('data-cover-count','1');
    await page.goto(base+'/liked',{waitUntil:'domcontentloaded'});await page.getByRole('searchbox',{name:'Find a liked song'}).fill('Unpublished');await page.getByRole('button',{name:'Play Unpublished fixture',exact:true}).click();
    await page.getByRole('button',{name:'Open now playing',exact:true}).click();player=page.locator('dialog[data-dialog-appearance="player"]');await expect(player).toHaveAttribute('data-dialog-phase','open');
    await player.getByRole('button',{name:'Lyrics',exact:true}).click();lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
    await lyrics.getByRole('button',{name:'Missing lyrics? Add the words',exact:true}).click();const studio=page.locator('dialog').last(),text=studio.getByRole('textbox',{name:'Lyrics text',exact:true});await text.fill('Freshly published words');
    const pausedBefore=await page.evaluate(()=>window.readingFixtureAudio.paused);await text.press('Space');assert.equal(await page.evaluate(()=>window.readingFixtureAudio.paused),pausedBefore,'Typing Space never changes playback');
    await studio.getByRole('button',{name:'Publish to LRCLIB',exact:true}).click();await expect(lyrics.locator('button[data-lyric-index="0"]')).toContainText('Freshly published words');assert.equal(publications,width>=700?1:2);
    await page.screenshot({path:`${output}/complete-${width}.png`});
    report.checks.push(`${width}px: pagination, collaborator/album/non-Latin searches, Chinese/Korean readings, current-recording taste actions, mouse/touch lyric focus, Space after click/selection, repeat/IME isolation, seek/volume/native slider keys, song keys, help/queue/player/lyrics/search shortcuts, album dialog navigation, 4-cover mix/3-cover broken fallback/0-cover empty/1-cover custom playlist, typed-space isolation and exact fresh upload result`);
  }finally{await context.close();}
}
try{
  await fs.mkdir(output,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [1440,390])await run(width);
  assert.deepEqual(report.errors,[]);await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.failure=error.message;await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();}
