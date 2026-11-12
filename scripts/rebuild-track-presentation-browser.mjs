/** Real collection/player screens with generated tone and intercepted APIs; no DB writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const expect=baseExpect.configure({timeout:20000});
const base=process.env.SAKURA_TEST_URL||'http://127.0.0.1:3015';
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local auth signing configuration is required');
const account={id:'90000000-0000-4000-8000-000000000112',username:'Presentation fixture',email:'presentation@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const rate=24000,samples=rate*18,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*330/rate)*1800),44+i*2);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['夜のしおり','A quiet chorus','The long way home (Moonlight Remix)'].map((title,i)=>{
 const id=`80000000-0000-4000-8000-${String(112+i).padStart(12,'0')}`,assetId=`81000000-0000-4000-8000-${String(112+i).padStart(12,'0')}`;
 return {id,recordingId:id,title,artists:[i?'A little voice':'灯り'],artistId:null,albumId:null,albumTitle:'Generated presentation fixture',coverUrl:null,durationMs:18000,versionLabel:i===2?'Moonlight Remix':'Original recording',reference:{provider:'deezer',id:String(112+i)},references:[{provider:'deezer',id:String(112+i)}],readyPlayback:{kind:'stream',delivery:'cdn',assetId,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:18000,url:`https://res.cloudinary.com/presentation-fixture/video/upload/v1/sakura/v2/audio/${id}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/${id}/audio?assetId=${assetId}`}};
});
const lines=[{text:'君の声が、ここにある',start:0,end:3.5},{text:'',start:3.5,end:5},{text:'夜空に、ひとつの歌',start:5,end:8},{text:'',start:8,end:18}];
const report={checkedAt:new Date().toISOString(),scope:'Production screens; generated tone and synthetic account/lyrics APIs',checks:[],variants:[],pageErrors:[]};
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 await fs.mkdir('.local/track-presentation',{recursive:true});
 for(const variant of [{name:'desktop-light',viewport:{width:1440,height:1000},theme:'light'},{name:'phone-light',viewport:{width:390,height:844},theme:'light',isMobile:true,hasTouch:true},{name:'phone-dark',viewport:{width:360,height:800},theme:'dark',isMobile:true,hasTouch:true}]){
  const context=await browser.newContext({...variant,colorScheme:variant.theme,serviceWorkers:'block'});
  await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
  await context.addInitScript(()=>{sessionStorage.setItem('sakura-ink-opening','1');const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.presentationAudio=audio;return audio;};window.Audio.prototype=NativeAudio.prototype;});
  const lyricRequests=new Map();let session=null;
  const settings={theme:variant.theme,audioTechnology:'none',audioQuality:'data-saver',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.4,shuffle:false,repeat:'off'};
  function audio(route){const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(!range)return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Length':String(wav.length)}});const start=Number(range[1]),end=range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;return route.fulfill({status:206,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Accept-Ranges':'bytes'}});}
  await context.route('https://res.cloudinary.com/presentation-fixture/**',audio);
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return audio(route);
   if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
   if(path==='/api/v2/settings'){if(request.method()==='PATCH')Object.assign(settings,request.postDataJSON());return route.fulfill({json:settings});}
   if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:[]}});
   if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,playlists:[]}});
   if(path==='/api/v2/listening-session'){
    if(request.method()==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
    return route.fulfill({json:{session,serverTime:Date.now()}});
   }
   if(path==='/api/v2/recordings/resolve'){const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
   if(path==='/api/v2/lyrics'){const id=url.searchParams.get('recordingId');lyricRequests.set(id,(lyricRequests.get(id)||0)+1);await new Promise(resolve=>setTimeout(resolve,200));return route.fulfill({json:{lines:id===tracks[0].id?lines:[{text:'Plain words stay in the lyrics room.',start:0}],timing:id===tracks[0].id?'synced':'plain',provider:'Synthetic verification',providerTrackId:112,schemaVersion:'verified-lyrics-v1',hasJapanese:id===tracks[0].id}});}
   if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
   if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(item=>item.id===path.split('/').at(-1))||tracks[0]}});
   return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.pageErrors.push(variant.name+': '+error.message));
  await page.goto(base+'/library',{waitUntil:'domcontentloaded',timeout:90000});
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  const trackList=page.locator('[data-track-layout]');
  await expect(trackList).toHaveAttribute('data-track-layout','list');
  for(const layout of ['cards','compact','list']){
   await page.getByRole('button',{name:layout[0].toUpperCase()+layout.slice(1)+' layout',exact:true}).click();
   await expect(trackList).toHaveAttribute('data-track-layout',layout);
   await expect(trackList.locator('[data-song-id]')).toHaveCount(3);
   const bounds=await trackList.evaluate(list=>({list:list.getBoundingClientRect().toJSON(),rows:[...list.querySelectorAll('[data-song-id]')].map(row=>row.getBoundingClientRect().toJSON()),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(bounds.overflow,false,variant.name+' '+layout+' has no horizontal overflow');
   assert.ok(bounds.rows.every(row=>row.left>=bounds.list.left-1&&row.right<=bounds.list.right+1),variant.name+' '+layout+' rows fit collection');
   if(layout==='cards')await page.screenshot({path:'.local/track-presentation/'+variant.name+'-cards.png'});
  }
  await page.getByRole('button',{name:'Cards layout',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await expect(page.locator('[data-track-layout]')).toHaveAttribute('data-track-layout','cards');
  report.checks.push(variant.name+': list/cards/compact fit screen and layout survives reload');
  await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!window.presentationAudio&&!window.presentationAudio.paused)).toBe(true);
  await page.getByRole('button',{name:'Open now playing',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-mini-lyric]')).toHaveText('君の声が、ここにある');
  assert.equal(lyricRequests.get(tracks[0].id),1,'mini/fullscreen share one lyric request');
  // The existing mobile sheet intentionally hides its header close button.
  // Escape is its accessible keyboard dismissal; touch dismissal is covered
  // by rebuild-japanese-reading-browser.mjs using the real pull gesture.
  if(variant.isMobile)await page.keyboard.press('Escape');
  else await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(()=>{window.presentationAudio.currentTime=4;window.presentationAudio.dispatchEvent(new Event('timeupdate'));});
  await expect(page.locator('[data-mini-lyric]')).toHaveCount(0);
  assert.equal(lyricRequests.get(tracks[0].id),1,'position updates and equal metadata replacements retain one lyric request');
  await page.evaluate(()=>{window.presentationAudio.currentTime=5.2;window.presentationAudio.dispatchEvent(new Event('timeupdate'));});
  await expect(page.locator('[data-mini-lyric]')).toHaveText('夜空に、ひとつの歌');
  await page.getByRole('button',{name:'Pause '+tracks[0].title,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.presentationAudio.paused)).toBe(true);
  await page.screenshot({path:'.local/track-presentation/'+variant.name+'-lyrics.png'});
  await page.getByRole('button',{name:'Play '+tracks[1].title,exact:true}).click();
  await expect.poll(()=>lyricRequests.get(tracks[1].id)||0).toBe(1);
  await expect(page.locator('[data-mini-lyric]')).toHaveCount(0);
  assert.equal(lyricRequests.get(tracks[0].id),1,'lyrics remain coalesced through all seeks and song changes');
  report.checks.push(variant.name+': synced Japanese mini lyrics follow seek, hide in silence, pause correctly and clear on an unsynced song');
  report.variants.push({name:variant.name,lyricRequests:Object.fromEntries(lyricRequests)});
  await context.close();
 }
 assert.deepEqual(report.pageErrors,[]);
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await fs.mkdir('.local/track-presentation',{recursive:true});await fs.writeFile('.local/track-presentation/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
