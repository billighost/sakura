import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import {chromium,expect as baseExpect} from '@playwright/test';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3016';
const expect=baseExpect.configure({timeout:30000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000300',username:'Mika',email:'top-songs@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const rate=24000,samples=rate*15,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*330/rate)*700),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const names=['Garden Song','Shinunoga E-Wa','Free Mind','From The Start','Night Drive','Nandemonaiya','Snooze','Plastic Love'];
const artists=['Phoebe Bridgers','Fujii Kaze','Tems','Laufey','The Midnight','RADWIMPS','SZA','Mariya Takeuchi'];
const covers=['sakura','japan','ocean','glass','cosmos','jungle','disco','korea'];
const tracks=Array.from({length:55},(_,i)=>{
 const id=`80000000-0000-4000-8000-${String(i+300).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(i+300).padStart(12,'0')}`;
 return {id,recordingId:id,title:i<8?names[i]:`Song ${i+1}`,artists:i<8?[artists[i]]:[`Artist ${55-i}`],albumTitle:`Album ${55-i}`,durationMs:15000,coverUrl:`/bloom/covers/${covers[i%8]}-light-480.webp`,reference:{provider:'deezer',id:String(i+300)},references:[{provider:'deezer',id:String(i+300)}],audibleMs:(55-i)*60000,playCount:i+1,lastPlayedAt:new Date(Date.UTC(2026,10,i+1)).toISOString(),readyPlayback:{kind:'stream',delivery:'cdn',assetId,sizeBytes:wav.length,sha256:sha,mimeType:'audio/wav',durationMs:15000,url:`https://res.cloudinary.com/top-songs-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const defaults={theme:'light',audioQuality:'data-saver',audioTechnology:'none',privateSession:false,discovery:.35,artistVariety:.65,repeatTolerance:.45,newReleaseBias:.5,deepCutBias:.35,timeAware:true,learnFromListening:true,reducedMotion:true,openingAnimation:0,seedArtists:[],seedGenres:[],onboarded:true,timeZone:'Africa/Lagos',explicitContent:true,volume:.5,shuffle:false,repeat:'off',previewVolume:.5,previewLoop:true,sleepTimerMinutes:0};
const profile={profile:account,stats:{audibleMs:92400000,playCount:900,uniqueRecordings:55,completedCount:800,skippedCount:100,liked:0,playlists:0},topArtists:[],insights:{days:[],hours:[],genres:[],completionRate:.9,skipRate:.1,activeDays:30,finishedEvents:900,confidence:{level:'established',label:'A fuller listening history',evidence:'55 songs across 30 days.'},topSongs:tracks,timeZone:'Africa/Lagos'}};
await fs.mkdir('.local',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[];
try{
 for(const [name,viewport,dark] of [['desktop',{width:1440,height:1050},false],['mobile',{width:390,height:844},false],['narrow-dark',{width:320,height:740},true]]){
  const context=await browser.newContext({viewport,colorScheme:dark?'dark':'light',reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.Audio=function(...args){const a=new NativeAudio(...args);window.__topSongsAudio=a;return a;};window.Audio.prototype=NativeAudio.prototype;});
  const settings={...defaults,theme:dark?'dark':'light'},requests=[],preferences=new Map();let session=null,empty=false;
  async function audio(route){
   const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
   if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Length':String(wav.length)}});
   const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
   return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes','Content-Length':String(end-start+1)}});
  }
  await context.route('https://res.cloudinary.com/top-songs-fixture/**',audio);
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),body=method==='GET'?null:request.postDataJSON();requests.push({path,method,body});
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(path==='/api/v2/profile'||path==='/api/v2/bootstrap')return route.fulfill({json:empty?{...profile,insights:{...profile.insights,topSongs:[]}}:profile});
   if(path==='/api/v2/settings'){if(method==='PATCH')Object.assign(settings,body);return route.fulfill({json:settings});}
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});
   if(path==='/api/v2/collection-view'){const room=body?.room||url.searchParams.get('room');if(method==='PATCH')preferences.set(room,{...body,updatedAt:new Date().toISOString()});return route.fulfill({json:{room,preference:preferences.get(room)||null}});}
   if(path==='/api/v2/listening-session'){if(method==='PUT')session={state:body.state,revision:(session?.revision||0)+1,deviceId:body.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   if(path==='/api/v2/recordings/resolve'){const track=tracks.find(track=>track.reference.id===body.reference?.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:track,playback:{...track.readyPlayback}}});}
   if(path.endsWith('/audio'))return audio(route);
   if(path==='/api/v2/smart-queue')return route.fulfill({json:{tracks:tracks.slice(0,4),reason:'Your fixture soundtrack'}});
   if(path==='/api/v2/playlists'&&method==='POST')return route.fulfill({json:{id:'top-songs-playlist',name:body.name,trackCount:body.recordingIds.length}});
   if(path==='/api/v2/history')return route.fulfill({json:method==='POST'?{accepted:true}:{events:[]}});
   return route.fulfill({json:{items:[],recordings:[],playlists:[],feedback:[],albums:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(name+': '+error.message));
  await page.goto(base+'/profile',{waitUntil:'domcontentloaded',timeout:90000});
  const preview=page.locator('section').filter({has:page.getByRole('heading',{name:'The songs you play most.'})});
  await expect(preview.locator('[data-track-layout] a[href^="/track/"]')).toHaveCount(8);
  await page.getByRole('link',{name:'View all your top songs'}).click();
  const mix=page.locator('[data-top-songs-mix]');await expect(mix).toBeVisible({timeout:90000});
  const songLinks=mix.locator('[data-track-layout] a[href^="/track/"]');await expect(songLinks).toHaveCount(50);
  await expect(songLinks.first()).toHaveText('Garden Song');await expect(mix.getByText('55m listened',{exact:true})).toBeVisible();
  const notice=page.getByRole('button',{name:'Dismiss notice',exact:true});if(await notice.isVisible())await notice.click();
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`.local/top-songs-${name}.png`,fullPage:false});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' must fit without horizontal scrolling');
  async function sort(label){await mix.getByRole('combobox',{name:'Sort songs',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();}
  await sort('Number of plays');await expect(songLinks.first()).toHaveText('Song 50');
  await mix.getByRole('button',{name:'Reverse sort order',exact:true}).click();await expect(songLinks.first()).toHaveText('Garden Song');
  await sort('Recently played');await expect(songLinks.first()).toHaveText('Song 50');
  await sort('Artist name');await expect(songLinks.first()).toHaveText('Song 50');
  await sort('Album name');await expect(songLinks.first()).toHaveText('Song 50');
  await sort('Song title');await expect(songLinks.first()).toHaveText('Free Mind');
  const search=mix.getByRole('searchbox',{name:'Find in your top songs'});await search.fill('Tems');await expect(songLinks).toHaveCount(1);await expect(songLinks.first()).toHaveText('Free Mind');
  await search.fill('missing song');await expect(mix.getByRole('heading',{name:'No songs match that search.'})).toBeVisible();await mix.getByRole('button',{name:'Clear search',exact:true}).click();
  await sort('Listening time');await mix.getByRole('button',{name:'Cards layout',exact:true}).click();await expect(mix.locator('[data-track-layout]')).toHaveAttribute('data-track-layout','cards');
  await mix.getByRole('button',{name:'Compact layout',exact:true}).click();await expect(mix.getByText('55m listened',{exact:true})).toBeVisible();
  await mix.getByRole('button',{name:'List layout',exact:true}).click();
  if(name==='desktop'){
   await sort('Number of plays');await mix.getByRole('button',{name:'Play mix',exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>Boolean(window.__topSongsAudio&&!window.__topSongsAudio.paused&&window.__topSongsAudio.currentTime>0))).toBe(true);
   await expect(mix.getByRole('button',{name:'Pause mix',exact:true})).toBeVisible();await mix.getByRole('button',{name:'Pause mix',exact:true}).click();
   await expect.poll(()=>session?.state?.queue?.some(entry=>entry.track?.title==='Song 50')).toBe(true);
   await mix.getByRole('button',{name:'Make a playlist from your top songs',exact:true}).click();
   const dialog=page.getByRole('dialog');await expect(dialog.getByRole('checkbox')).toHaveCount(50);await dialog.getByRole('button',{name:'Create playlist',exact:true}).click();
   await expect(dialog.getByRole('heading',{name:'Your playlist is ready.',exact:true})).toBeVisible();
   const created=requests.find(request=>request.path==='/api/v2/playlists'&&request.method==='POST');assert.equal(created.body.recordingIds.length,50);assert.equal(created.body.recordingIds[0],tracks[49].id);
   await dialog.getByRole('button',{name:'Keep listening',exact:true}).click();
   await mix.getByRole('button',{name:'Shuffle your top songs',exact:true}).click();await expect(mix.getByRole('button',{name:'Shuffle your top songs',exact:true})).toHaveAttribute('aria-pressed','true');
   await mix.getByRole('button',{name:'Download your top songs',exact:true}).click();
   await expect.poll(async()=>await mix.getByRole('progressbar').count()+await mix.getByRole('button',{name:/is ready offline$/}).count()).toBe(50);
   checks.push('Sorted playback, pause, shuffle, all 50 download requests and playlist creation work');
  }
  await sort('Number of plays');await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('combobox',{name:'Sort songs',exact:true})).toHaveText(/Number of plays/);
  empty=true;await page.evaluate(id=>localStorage.setItem('sakura-v2-resource-invalidated:'+id+':/api/v2/profile',String(Date.now()+1000)),account.id);await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Your repeat listens start here.',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Play mix',exact:true})).toBeDisabled();
  checks.push(name+': profile navigation, 50 songs, sorting, search, layouts, saved preference, empty state and no overflow');await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,screenshots:['desktop','mobile','narrow-dark'].map(name=>`.local/top-songs-${name}.png`)},null,2));
}finally{await browser.close();}
