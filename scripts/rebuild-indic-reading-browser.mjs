/** Real app and local reading engine; short actual-song excerpts and generated audio.
 * Account/audio/provider routes are intercepted. This is browser integration
 * evidence, not a live-provider or physical-device pronunciation measurement. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import {READING_LABELS, readingEngine} from '../src/rebuild/lyrics/language.ts';
import {romanizeLyricLines} from '../src/rebuild/lyrics/readings.ts';
import {READING_SONG_EXCERPTS, pronunciationLetters} from './fixtures/reading-song-excerpts.ts';
import 'dotenv/config';

const expect = baseExpect.configure({timeout:25000});
const base = process.env.SAKURA_TEST_URL || 'http://localhost:3001';
const output = '.local/indic-transliteration-browser';
const freshDeviceOnly = process.argv.includes('--fresh-device-race');
const reportFile = freshDeviceOnly ? 'fresh-device-race-report.json' : 'report.json';
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
assert.ok(secret, 'Local auth signing configuration is required');
const account = {id:'94000000-0000-4000-8000-000000000611',username:'Indic reading fixture',email:'indic-readings@example.invalid'};
const token = await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const languages = ['ja','hi','te','kn','ml','or','sr','ka'];
const songs = languages.map(language => {
  const song = READING_SONG_EXCERPTS.find(item => item.language === language);
  assert.ok(song, `An independently checked actual-song excerpt is required for ${language}`);
  assert.ok(READING_LABELS[language], `Missing reading support for ${language}`);
  return song;
});
const unsupported = [
  {id:'marathi-browser',title:'Marathi lyric fixture',artist:'Script fixture',language:'mr',text:'माझे मन तुझ्याकडे आहे'},
  {id:'nepali-browser',title:'Nepali lyric fixture',artist:'Script fixture',language:'ne',text:'तिमी मेरो माया हौ'},
];
const allSongs = [...songs,...unsupported];
const samples = 8000 * 40;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(samples*2,40);
for (let index=0;index<samples;index++) wav.writeInt16LE(Math.round(Math.sin(index*2*Math.PI*330/8000)*800),44+index*2);
const sha = createHash('sha256').update(wav).digest('hex');
const tracks = allSongs.map((song,index) => {
  const id = `95000000-0000-4000-8000-${String(index+611).padStart(12,'0')}`;
  const assetId = `96000000-0000-4000-8000-${String(index+611).padStart(12,'0')}`;
  return {
    id,title:song.title,artists:[song.artist],artistId:null,albumId:null,
    albumTitle:'Short lyric browser fixture',durationMs:40000,coverUrl:`/indic-reading-cover-${index}.svg`,
    versionLabel:'Original recording',language:index>=songs.length || song.hintRequired ? song.language : undefined,
    reference:{provider:'deezer',id:String(index+611)},references:[{provider:'deezer',id:String(index+611)}],
    readyPlayback:{kind:'stream',delivery:'cdn',assetId,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:40000,
      url:`https://res.cloudinary.com/indic-reading-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,
      fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`},
  };
});
const sourceLines = allSongs.map(song => [
  {text:song.text,start:0,end:30,words:[{text:song.text,start:0,end:30}]},
  {text:`Hello 🌸, ${song.text}!`,start:30,end:40},
]);
const expectedReadings = [];
for (let index=0;index<songs.length;index++) {
  const readings = await romanizeLyricLines(sourceLines[index],songs[index].language,undefined,songs[index].hintRequired?songs[index].language:undefined);
  const song = songs[index];
  if (song.mode === 'pronunciation') assert.equal(pronunciationLetters(readings[0].romanized),pronunciationLetters(song.expected), `${song.id}: independent excerpt pronunciation`);
  else assert.equal(readings[0].romanized.normalize('NFC'),song.expected.normalize('NFC'), `${song.id}: independent excerpt romanization`);
  expectedReadings.push(readings.map(line => line.romanized));
}

const report = {checkedAt:new Date().toISOString(),scope:'Real Sakura browser UI plus the actual local reading engine; short independently checked song excerpts, generated audio, intercepted account/provider routes. Offline checks keep the app shell available and simulate provider disconnection.',songs:songs.map(({id,title,language})=>({id,title,language})),checks:[],rooms:[],errors:[]};
let browser,latestPage;

async function room(theme,width,sharedSettings) {
  const context = await browser.newContext({viewport:{width,height:width<700?844:900},isMobile:width<700,hasTouch:width<700,colorScheme:theme,serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(holdOriginalWrites => {
    sessionStorage.setItem('sakura-ink-opening','1');
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>localStorage.getItem('indic-provider-offline')!=='1'});
    if(holdOriginalWrites){
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...rest){
        const request=put.call(this,value,...rest);
        if(this.name==='lyrics'&&value?.data?.readingLanguage==='ml'&&value.data.lines.every(line=>line.romanized===undefined)){
          const tx=this.transaction;
          Object.defineProperty(tx,'oncomplete',{configurable:true,set(callback){
            tx.addEventListener('complete',event=>(window.indicHeldLyricWrites||=[]).push(()=>callback.call(tx,event)),{once:true});
          }});
        }
        return request;
      };
    }
    document.addEventListener('DOMContentLoaded',() => {
      const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
    },{once:true});
  },freshDeviceOnly);
  const settings = sharedSettings || {theme,audioTechnology:'none',japaneseReading:false,lyricReading:false,audioQuality:'balanced',privateSession:true,reducedMotion:false,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.4,shuffle:false,repeat:'off',revision:1,fieldRevisions:{}};
  const counts = {readings:0,lyrics:0,patches:0,blocked:0,audio:0,languages:[]};
  let session = null,blockProviders = false;
  const serveAudio = route => {
    counts.audio++;
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    if (!range) return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Length':String(wav.length)}});
    const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
    return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});
  };
  await context.route('https://res.cloudinary.com/indic-reading-fixture/**',serveAudio);
  await context.route('**/indic-reading-cover-*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#d8ba9f"/><path d="M0 440Q150 300 280 430T600 370V600H0Z" fill="#71867f"/><circle cx="440" cy="130" r="58" fill="#f5e5c9"/><text x="40" y="75" fill="#4c5954" font-size="32" font-family="Georgia">a song, in its own words.</text></svg>'}));
  await context.route('**/api/**',async route => {
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if (/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path)) return serveAudio(route);
    if (path==='/api/v2/bootstrap'||path==='/api/v2/profile') return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
    if (path==='/api/auth/session') return route.fulfill({json:{user:account}});
    if (path==='/api/v2/settings') {
      if (request.method()==='PATCH') {
        counts.patches++; const patch=request.postDataJSON(); delete patch.expectedRevision;
        Object.assign(settings,patch); settings.revision++;
        for (const key of Object.keys(patch)) settings.fieldRevisions[key]=settings.revision;
      }
      return route.fulfill({json:settings});
    }
    if (path==='/api/v2/library/state') return route.fulfill({json:{favoriteStates:Object.fromEntries(tracks.map(track=>[track.id,{liked:true,revision:1}]))}});
    if (path==='/api/v2/home') return route.fulfill({json:{featured:tracks,mixes:[],recent:tracks}});
    if (path==='/api/v2/library') return route.fulfill({json:{recordings:tracks,tracks,playlists:[],nextCursor:null}});
    if (path==='/api/v2/listening-session') {
      if (request.method()==='PUT') {
        const data=request.postDataJSON(); session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};
        return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});
      }
      return route.fulfill({json:{session,serverTime:Date.now()}});
    }
    if (path==='/api/v2/recordings/resolve') {
      const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];
      return route.fulfill({json:{status:'resolved',recording:{...track,recordingId:track.id,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle,language:track.language}},playback:track.readyPlayback}});
    }
    if (path==='/api/v2/lyrics') {
      if (blockProviders) {counts.blocked++;return route.abort('internetdisconnected');}
      counts.lyrics++;
      const index=tracks.findIndex(track=>track.title===url.searchParams.get('title'));
      assert.ok(index>=0,'Only fixture lyric identities may be requested');
      return route.fulfill({json:{status:'matched',lines:sourceLines[index],timing:'synced',provider:'actual-song excerpt browser fixture',providerTrackId:611+index,schemaVersion:'verified-lyrics-v3'}});
    }
    if (path==='/api/v2/readings') {
      if (blockProviders) {counts.blocked++;return route.abort('internetdisconnected');}
      const input=request.postDataJSON(); counts.readings++; counts.languages.push(input.language);
      assert.ok(languages.includes(input.language),'Unsupported shared-script hints must not request a guessed language');
      const lines=await romanizeLyricLines(input.lines,input.language,undefined,input.languageHint);
      assert.deepEqual(lines.map(({text,start,end,words})=>({text,start,end,...(words?{words}:{})})),input.lines,'Reading transformations must preserve every original text/timing field');
      return route.fulfill({json:{engine:readingEngine(input.language),lines}});
    }
    if (/^\/api\/v2\/recordings\/[^/]+$/.test(path)) return route.fulfill({json:{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]}});
    return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
  });
  const page=await context.newPage(); latestPage=page;
  page.on('pageerror',error=>report.errors.push(`${theme}/${width}: ${error.message}`));
  return {context,page,settings,counts,providers:enabled=>{blockProviders=!enabled;}};
}

async function openPlayer(page) {
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();
  const dialog=page.locator('dialog[data-dialog-appearance="player"]');
  await expect(dialog).toHaveAttribute('data-dialog-phase','open'); return dialog;
}
async function pausePlayer(dialog) {
  const pause=dialog.getByRole('button',{name:'Pause',exact:true});
  await expect(pause).toBeVisible(); await pause.click();
  await expect(dialog.getByRole('button',{name:'Play',exact:true})).toBeVisible();
}
async function closeDialog(page,dialog) {await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);}
async function selectSong(page,index) {
  await page.getByRole('button',{name:`Play ${tracks[index].title}`,exact:true}).click();
  const dialog=await openPlayer(page);await pausePlayer(dialog);return dialog;
}
async function assertGuide(page,dialog,index) {
  await expect(dialog.getByRole('heading',{name:tracks[index].title,exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:READING_LABELS[songs[index].language],exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.locator('[data-player-reading]')).toHaveText(expectedReadings[index][0]);
  await expect(dialog.getByRole('button',{name:'Open lyrics',exact:true})).toContainText(songs[index].text);
  await expect(page.locator('[data-mini-lyric] i')).toHaveText(expectedReadings[index][0]);
  await expect(page.locator('[data-mini-lyric] i')).toHaveAttribute('lang',`${songs[index].language}-Latn`);
}
async function assertSavedOriginals(page) {
  const stored=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const request=db.transaction('lyrics','readonly').objectStore('lyrics').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    db.close();return rows;
  });
  for (let index=0;index<songs.length;index++) {
    const saved=stored.find(row=>row.data?.providerTrackId===611+index);
    assert.ok(saved,`${songs[index].language}: native lyrics must be persisted`);
    assert.equal(saved.data.schemaVersion,'verified-lyrics-v3'); assert.equal(saved.data.timing,'synced');
    assert.deepEqual(saved.data.lines.map(({text,start,end,words})=>({text,start,end,...(words?{words}:{})})),sourceLines[index],`${songs[index].language}: persisted text, line times and word times`);
  }
}

async function readingState(page,counts,index) {
  const cached=await page.evaluate(async providerId=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const request=db.transaction('lyrics','readonly').objectStore('lyrics').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    db.close();return rows.filter(row=>row.data?.providerTrackId===providerId).map(row=>({language:row.data.readingLanguage,provenance:row.data.readingLanguageSource,lines:row.data.lines.map(({text,start,end,words,romanized,readingEngine})=>({text,start,end,...(words?{words}:{}),romanized,readingEngine}))}));
  },611+index);
  return {counts:{...counts,languages:[...counts.languages]},miniText:await page.locator('[data-mini-lyric]').allTextContents(),miniGuide:await page.locator('[data-mini-lyric] i').allTextContents(),fullGuide:await page.locator('[data-player-reading]').allTextContents(),cached};
}

async function verifyFreshDeviceRace() {
  const r=await room('light',1440);
  Object.assign(r.settings,{japaneseReading:true,lyricReading:true});
  try {
    await r.page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
    await r.page.getByRole('button',{name:`Play ${tracks[4].title}`,exact:true}).click();
    let dialog=await openPlayer(r.page);
    const position=dialog.getByRole('slider',{name:'Playback position',exact:true});
    await expect.poll(()=>position.evaluate(input=>Number(input.value))).toBeGreaterThan(200);
    await pausePlayer(dialog);
    await expect(dialog.locator('[data-player-reading]')).toHaveText(expectedReadings[4][0]);
    await expect(r.page.locator('[data-mini-lyric] i')).toHaveText(expectedReadings[4][0]);
    await expect.poll(()=>r.page.evaluate(()=>window.indicHeldLyricWrites?.length||0)).toBeGreaterThan(0);
    const beforeRelease=await readingState(r.page,r.counts,4);
    assert.deepEqual(beforeRelease.miniGuide,[expectedReadings[4][0]],'The guide must reach the mini view before releasing its older load');
    const heldWrites=await r.page.evaluate(()=>{const held=window.indicHeldLyricWrites;window.indicHeldLyricWrites=[];for(const release of held)release();return held.length;});
    // Let the deliberately delayed original result complete and publish its view.
    await r.page.waitForTimeout(1000);
    await expect(r.page.locator('[data-mini-lyric] i')).toHaveText(expectedReadings[4][0]);
    await expect(dialog.locator('[data-player-reading]')).toHaveText(expectedReadings[4][0]);
    const afterRelease=await readingState(r.page,r.counts,4);
    assert.deepEqual(afterRelease.cached,beforeRelease.cached,'Late originals must retain the saved guide, text and every timestamp');
    assert.equal(afterRelease.counts.readings,beforeRelease.counts.readings,'Late originals cannot require another reading request');
    await r.page.screenshot({path:output+'/fresh-device-before.png',animations:'disabled'});
    await closeDialog(r.page,dialog);dialog=await openPlayer(r.page);
    await assertGuide(r.page,dialog,4);
    const afterReopen=await readingState(r.page,r.counts,4);
    await dialog.getByRole('combobox',{name:'Reading language',exact:true}).click();
    await r.page.getByRole('option',{name:READING_LABELS.ml,exact:true}).click();
    await expect(r.page.locator('[data-mini-lyric] i')).toHaveText(expectedReadings[4][0]);
    const afterCachePublish=await readingState(r.page,r.counts,4);
    assert.equal(afterCachePublish.counts.readings,beforeRelease.counts.readings,'Reopening and same-language cache publication reuse the completed guide');
    await r.page.screenshot({path:output+'/fresh-device-after-publish.png',animations:'disabled'});
    report.freshDeviceRace={instrumentation:'Deferred only the initial originals-only Malayalam IndexedDB transaction completion callback until after its reading guide published; native transaction locks complete normally.',heldWrites,beforeRelease,afterRelease,afterReopen,afterCachePublish,extraReadingsAfterLateCompletion:afterCachePublish.counts.readings-beforeRelease.counts.readings};
    report.checks.push('Fresh enabled device: a late original-lyrics completion retains Roman mini/full/saved guides with unchanged native text/word timing and zero extra reading requests.');
  } catch(error) {
    report.freshDeviceRace={failure:error.message,...await readingState(r.page,r.counts,4),heldWrites:await r.page.evaluate(()=>window.indicHeldLyricWrites?.length||0)};
    await r.page.screenshot({path:output+'/fresh-device-race-failure.png',animations:'disabled'}).catch(()=>{});
    throw error;
  } finally {await r.context.close();}
}

async function verify(theme,width) {
  const r=await room(theme,width),{page,counts,settings}=r;
  const prefix=`${theme}/${width}`;
  try {
    await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
    let dialog=await selectSong(page,0);
    await expect(dialog.getByRole('button',{name:READING_LABELS.ja,exact:true})).toHaveAttribute('aria-pressed','false');
    await dialog.getByRole('button',{name:READING_LABELS.ja,exact:true}).click();
    await expect.poll(()=>settings.lyricReading===true&&settings.japaneseReading===true).toBe(true);
    for (let index=0;index<songs.length;index++) {
      if (index) {await dialog.getByRole('button',{name:'Next song',exact:true}).click();await expect(dialog.getByRole('heading',{name:tracks[index].title,exact:true})).toBeVisible();await pausePlayer(dialog);}
      await assertGuide(page,dialog,index);
      await dialog.getByRole('button',{name:'Open lyrics',exact:true}).click();
      const words=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(words).toHaveAttribute('data-dialog-phase','open');
      await expect(words.getByRole('button',{name:READING_LABELS[songs[index].language],exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(words.locator('[data-lyric-index="0"] > span')).toHaveText(songs[index].text);
      await expect(words.locator('[data-lyric-index="0"] > small')).toHaveText(expectedReadings[index][0]);
      await expect(words.locator('[data-lyric-index="1"] > span')).toHaveText(sourceLines[index][1].text);
      await expect(words.locator('[data-lyric-index="1"] > small')).toHaveText(expectedReadings[index][1]);
      await expect(words.getByText(/reading needs review/i)).toHaveCount(0);
      if (index===2||index===4||index===6) await words.screenshot({path:`${output}/lyrics-${theme}-${width}-${songs[index].language}.png`,animations:'disabled'});
      await closeDialog(page,words);
      report.checks.push(`${prefix}: ${songs[index].language} guide agrees across mini player, full player and full lyrics; native/mixed text and punctuation retained; review label absent.`);
    }
    for (const language of languages) assert.ok(counts.languages.includes(language),`${prefix}: ${language} was prepared by the actual local engine`);
    await assertSavedOriginals(page);
    await dialog.getByRole('button',{name:'Open lyrics',exact:true}).click();
    const words=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(words).toHaveAttribute('data-dialog-phase','open');
    await words.getByRole('button',{name:READING_LABELS.ka,exact:true}).click();
    await expect(words.locator('[data-lyric-index="0"] > small')).toHaveCount(0);
    await expect.poll(()=>settings.lyricReading===false&&settings.japaneseReading===false).toBe(true);
    await closeDialog(page,words);await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);await closeDialog(page,dialog);
    await page.goto(base+'/settings',{waitUntil:'domcontentloaded'});
    let toggle=page.getByRole('button',{name:'Enable transliteration',exact:true});
    await expect(toggle).toHaveAttribute('aria-pressed','false');await toggle.click();
    await expect.poll(()=>settings.lyricReading===true&&settings.japaneseReading===true).toBe(true);
    await page.goto(base+'/liked',{waitUntil:'domcontentloaded'});dialog=await selectSong(page,2);await assertGuide(page,dialog,2);
    const beforeReload=counts.readings;
    await page.reload({waitUntil:'domcontentloaded'});dialog=await selectSong(page,2);await assertGuide(page,dialog,2);
    assert.equal(counts.readings,beforeReload,'Reload must reuse completed saved reading guides');
    report.checks.push(`${prefix}: a lyrics disable and Settings enable update both compatibility fields; reload restores the enabled choice and completed guides without reading requests.`);
    const remote=await room(theme,width,settings);
    try {
      await remote.page.goto(base+'/liked',{waitUntil:'domcontentloaded'});
      const remotePlayer=await selectSong(remote.page,4);await assertGuide(remote.page,remotePlayer,4);
      assert.equal(remote.counts.patches,0,'A fresh browser device must inherit account preference without a settings mutation');
      report.checks.push(`${prefix}: a fresh browser device restores the saved global preference for Malayalam.`);
    } catch(error) {
      report.secondaryRoom={theme,width,failure:error.message,...await readingState(remote.page,remote.counts,4)};
      await remote.page.screenshot({path:`${output}/fresh-device-failure-${theme}-${width}.png`,animations:'disabled'}).catch(()=>{});
      throw error;
    } finally {await remote.context.close();}
    await closeDialog(page,dialog);
    for (let index=songs.length;index<tracks.length;index++) {
      dialog=await selectSong(page,index);
      await expect(dialog.getByRole('button',{name:'Open lyrics',exact:true})).toContainText(allSongs[index].text);
      await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
      await expect(dialog.getByRole('combobox',{name:'Reading language',exact:true})).toHaveCount(0);
      await closeDialog(page,dialog);
    }
    report.checks.push(`${prefix}: reliable Marathi and Nepali hints keep Devanagari originals and produce no guessed Hindi guide.`);
    dialog=await selectSong(page,2);await assertGuide(page,dialog,2);await closeDialog(page,dialog);
    const beforeOffline={readings:counts.readings,lyrics:counts.lyrics};
    await page.evaluate(()=>localStorage.setItem('indic-provider-offline','1'));r.providers(false);
    await page.reload({waitUntil:'domcontentloaded'});dialog=await openPlayer(page);await assertGuide(page,dialog,2);
    assert.equal(counts.readings,beforeOffline.readings);assert.equal(counts.lyrics,beforeOffline.lyrics);assert.equal(counts.blocked,0);
    await dialog.screenshot({path:`${output}/offline-${theme}-${width}.png`,animations:'disabled'});
    report.checks.push(`${prefix}: cold reload with navigator offline and lyric providers disconnected retains saved Telugu words/readings and makes no lyric/reading requests.`);
    await closeDialog(page,dialog);
    await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sakura-v2-lyrics-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('lyrics','readwrite'),store=tx.objectStore('lyrics'),request=store.openCursor();
        request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const value=cursor.value;
          if(value.data?.providerTrackId===613){
            value.data.readingLanguageVersion='multilingual-reading-v2';
            value.data.lines=value.data.lines.map(line=>({...line,romanized:'obsolete guide',readingEngine:'multilingual-reading-v2:te'}));
            if(value.guides?.te){value.guides.te.engine='multilingual-reading-v2:te';value.guides.te.lines=value.guides.te.lines.map(line=>({...line,romanized:'obsolete guide',readingEngine:'multilingual-reading-v2:te'}));}
            cursor.update(value);
          }cursor.continue();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });db.close();
    });
    await page.reload({waitUntil:'domcontentloaded'});dialog=await openPlayer(page);
    await expect(dialog.getByRole('button',{name:'Open lyrics',exact:true})).toContainText(songs[2].text);
    await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
    await expect(page.getByText('obsolete guide',{exact:true})).toHaveCount(0);
    assert.equal(counts.readings,beforeOffline.readings);assert.equal(counts.lyrics,beforeOffline.lyrics);assert.equal(counts.blocked,0);
    r.providers(true);
    await page.evaluate(()=>{localStorage.removeItem('indic-provider-offline');window.dispatchEvent(new Event('online'));});
    await assertGuide(page,dialog,2);
    assert.equal(counts.readings,beforeOffline.readings+1,'Reconnect regenerates exactly the obsolete current reading guide');
    assert.equal(counts.lyrics,beforeOffline.lyrics,'Pronunciation upgrades do not refetch verified original lyrics');
    await assertSavedOriginals(page);
    report.checks.push(`${prefix}: an obsolete engine guide is withheld offline while native text survives; reconnect regenerates one guide without lyric refetch or text/timing loss.`);
    await closeDialog(page,dialog);await page.goto(base+'/settings',{waitUntil:'domcontentloaded'});
    toggle=page.getByRole('button',{name:'Enable transliteration',exact:true});await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();
    await expect.poll(()=>settings.lyricReading===false&&settings.japaneseReading===false).toBe(true);
    await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Enable transliteration',exact:true})).toHaveAttribute('aria-pressed','false');
    const beforeDisabled=counts.readings;
    await page.goto(base+'/liked',{waitUntil:'domcontentloaded'});
    for (let index=0;index<songs.length;index++) {
      dialog=await selectSong(page,index);
      await expect(dialog.getByRole('button',{name:READING_LABELS[songs[index].language],exact:true})).toHaveAttribute('aria-pressed','false');
      await expect(dialog.locator('[data-player-reading]')).toHaveCount(0);
      await expect(page.locator('[data-mini-lyric] i')).toHaveCount(0);await closeDialog(page,dialog);
    }
    assert.equal(counts.readings,beforeDisabled,'A saved global disable prepares no new reading requests across languages');
    report.checks.push(`${prefix}: persisted global disable remains off across all eight languages and prepares no pronunciation work.`);
    report.rooms.push({theme,width,counts});
  } catch(error) {
    report.pageState={url:page.url(),text:(await page.locator('body').innerText()).slice(0,6000)};
    await page.screenshot({path:`${output}/failure-${theme}-${width}.png`,animations:'disabled'}).catch(()=>{});
    report.rooms.push({theme,width,counts,failure:error.message});throw error;
  } finally {await r.context.close();}
}

try {
  await fs.mkdir(output,{recursive:true});
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  if(freshDeviceOnly)await verifyFreshDeviceRace();else{await verify('light',1440);await verify('dark',390);}
  assert.deepEqual(report.errors,[]);await fs.writeFile(output+'/'+reportFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  report.failure=error.message;
  if(latestPage&&!latestPage.isClosed())await latestPage.screenshot({path:output+'/failure.png'}).catch(()=>{});
  await fs.mkdir(output,{recursive:true});await fs.writeFile(output+'/'+reportFile,JSON.stringify(report,null,2));throw error;
} finally {await browser?.close();}
