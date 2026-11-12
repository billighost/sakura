/** Real UI; synthetic English lyrics/audio and intercepted hosted-worker jobs.
 * No model is downloaded and no real audio or account mutation leaves the test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect as baseExpect} from '@playwright/test';
import {encode} from 'next-auth/jwt';
import 'dotenv/config';

const base=process.env.SAKURA_TEST_URL||'http://localhost:3000',expect=baseExpect.configure({timeout:20000});
const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;
assert.ok(secret,'Local fixture authentication signing configuration is required');
const account={id:'94010000-0000-4000-8000-000000000401',username:'Sync fixture',email:'sync@example.invalid'};
const token=await encode({token:{id:account.id,name:account.username},secret,salt:'authjs.session-token'});
const versions=await fs.readFile('src/rebuild/lyrics/versions.ts','utf8'),version=versions.match(/VERIFIED_LYRICS_VERSION\s*=\s*"([^"]+)"/)[1];
const wav=Buffer.alloc(44+8000*40*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const sha=createHash('sha256').update(wav).digest('hex');
const tracks=['A clear English song','Another English song'].map((title,index)=>({
 id:`95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`,title,artists:['Sync fixture'],artistId:null,albumId:null,albumTitle:'Audio analysis fixtures',durationMs:40000,coverUrl:null,versionLabel:'Original recording',reference:{provider:'deezer',id:String(index+401)},references:[{provider:'deezer',id:String(index+401)}],
 readyPlayback:{kind:'stream',delivery:'cdn',assetId:`96010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`,sha256:sha,sizeBytes:wav.length,mimeType:'audio/wav',durationMs:40000,url:`https://res.cloudinary.com/sync-fixture/video/upload/v1/sakura/v2/audio/95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}/${sha}.wav`,fallbackUrl:`/api/v2/recordings/95010000-0000-4000-8000-${String(index+401).padStart(12,'0')}/audio?assetId=96010000-0000-4000-8000-${String(index+401).padStart(12,'0')}`},
}));
const lines=[{text:'Hello world',start:0},{text:'We are here',start:0}];
const report={scope:'Real UI; synthetic media, English lyric text and hosted responses; no external uploads/downloads',checks:[],errors:[]};
await fs.mkdir('.local/auto-sync-browser',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
 await context.addInitScript(()=>sessionStorage.setItem('sakura-ink-opening','1'));
 let mode='complete',session=null,held=[],started=0,polls=0;
 const modelRequests=[];
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.hostname==='huggingface.co'||url.hostname==='cdn.jsdelivr.net'){modelRequests.push(request.url());return route.abort();}
  if(url.hostname==='res.cloudinary.com'||/^\/api\/v2\/recordings\/[^/]+\/audio$/.test(path))return route.fulfill({body:wav,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'}});
  if(!path.startsWith('/api/'))return route.continue();
  if(path==='/api/auth/session')return route.fulfill({json:{user:account}});
  if(path==='/api/v2/library/state')return route.fulfill({json:{favoriteStates:{}}});if((path==='/api/v2/bootstrap'||path==='/api/v2/profile'))return route.fulfill({json:{profile:account,stats:{},topArtists:[]}});
  if(path==='/api/v2/settings')return route.fulfill({json:{theme:'light',audioTechnology:'none',audioQuality:'balanced',privateSession:true,reducedMotion:true,openingAnimation:0,onboarded:true,seedArtists:[],seedGenres:[],discovery:.4,volume:.4,shuffle:false,repeat:'off',revision:1,fieldRevisions:{}}});
  if(path==='/api/v2/home')return route.fulfill({json:{featured:tracks,mixes:[],recent:tracks}});
  if(path==='/api/v2/library')return route.fulfill({json:{recordings:tracks,tracks,playlists:[],nextCursor:null}});
  if(path==='/api/v2/listening-session'){
   if(request.method()==='PUT'){const data=request.postDataJSON();session={state:data.state,revision:data.revision+1,deviceId:data.deviceId,updatedAt:Date.now()};return route.fulfill({json:{accepted:true,session,serverTime:Date.now()}});}
   return route.fulfill({json:{session,serverTime:Date.now()}});
  }
  if(path==='/api/v2/recordings/resolve'){const track=tracks.find(item=>item.reference.id===request.postDataJSON().reference.id)||tracks[0];return route.fulfill({json:{status:'resolved',recording:{...track,recordingId:track.id,metadata:{title:track.title,artists:track.artists,artistsComplete:true,durationMs:track.durationMs,albumTitle:track.albumTitle}},playback:track.readyPlayback}});}
  if(path==='/api/v2/lyrics')return route.fulfill({json:{status:'matched',lines,timing:'plain',provider:'plain synthetic fixture',providerTrackId:401,schemaVersion:version}});
  if(path==='/api/v2/lyrics/sync'){
   const input=request.postDataJSON();
   if(input.recordingId){started++;assert.equal(input.lines.length,2);assert.ok(tracks.some(track=>track.id===input.recordingId));return route.fulfill({json:{status:'pending',jobToken:'fixture-job-'+started}});}
   polls++;
   if(mode==='held'){held.push(route);return;}
   if(mode==='error')return route.fulfill({status:503,json:{reason:'lyrics-sync-unavailable',error:'The free lyric worker has no remaining quota. Try again later.'}});
   return route.fulfill({json:{status:'complete',lines:[{text:'Hello world',start:2,end:4},{text:'We are here',start:7,end:9}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:createHash('sha256').update(JSON.stringify(lines.map(line=>line.text))).digest('hex')}}});
  }
  if(/^\/api\/v2\/recordings\/[^/]+$/.test(path))return route.fulfill({json:{recording:tracks.find(track=>track.id===path.split('/').at(-1))||tracks[0]}});
  return route.fulfill({json:{items:[],recordings:[],schedule:{timeZone:'Africa/Lagos'}}});
 });
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base+'/liked',{waitUntil:'domcontentloaded',timeout:90000});
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await page.getByRole('button',{name:'Play '+tracks[0].title,exact:true}).click();
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();
 const player=page.locator('dialog[data-dialog-appearance="player"]');await expect(player).toHaveAttribute('data-dialog-phase','open');
 await player.getByRole('button',{name:'Lyrics',exact:true}).click();
 const lyrics=page.locator('dialog[data-dialog-appearance="lyrics"]');await expect(lyrics).toHaveAttribute('data-dialog-phase','open');
 const sync=lyrics.getByRole('button',{name:'Auto sync',exact:true});await expect(sync).toBeVisible();
 mode='held';await sync.click();await expect(lyrics.getByRole('button',{name:'Cancel auto sync',exact:true})).toHaveAttribute('aria-busy','true');
 await expect.poll(()=>held.length).toBe(1);
 await lyrics.getByRole('button',{name:'Cancel auto sync',exact:true}).click();await expect(sync).toBeVisible();
 await held.pop().fulfill({json:{status:'complete',lines:[{text:'Hello world',start:2,end:4},{text:'We are here',start:7,end:9}],evidence:{engine:'whisper-small-en-v1',audioSha256:sha,confidence:.98,elapsedMs:4000,sourceContentKey:'canceled-fixture'}}}).catch(()=>{});
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 report.checks.push('Cancel suppresses a late worker result and keeps plain lyrics.');
 mode='complete';await sync.click();await expect(sync).toHaveCount(0);await expect(lyrics.getByText('Tap a line or press Enter to listen from that moment.',{exact:false})).toBeVisible();
 report.checks.push('Hosted result changes the existing lyric view to actual line timestamps.');
 await lyrics.getByRole('button',{name:'Next song',exact:true}).click();await expect(lyrics.locator('[data-auto-sync]')).toBeVisible();
 mode='error';await lyrics.getByRole('button',{name:'Auto sync',exact:true}).click();await expect(lyrics.locator('[data-auto-sync] [role="status"]')).toContainText(/quota|worker|temporar/i);
 await expect(lyrics.getByText('These lyrics are not time synced.',{exact:false})).toBeVisible();
 report.checks.push('Song changes reset sync state; worker failure keeps original plain words.');
 assert.deepEqual(modelRequests,[]);assert.deepEqual(report.errors,[]);
 report.checks.push('The browser fetched zero model files and uploaded zero audio files.');
 report.requests={started,polls};
 await page.screenshot({path:'.local/auto-sync-browser/result.png'});
 await fs.writeFile('.local/auto-sync-browser/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){if(page)await page.screenshot({path:'.local/auto-sync-browser/failure.png'}).catch(()=>{});throw error;}
finally{await browser.close();}
