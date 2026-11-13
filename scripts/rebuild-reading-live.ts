/** Bounded read-only lyric/provider audit. Full provider data stays in .local. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { lyricReadingLanguage, readingEngine, type ReadingLanguage } from '../src/rebuild/lyrics/language';
import { romanizeLyricLines } from '../src/rebuild/lyrics/readings';
import { selectLyricsCandidate, type LrcLibTrack } from '../src/rebuild/lyrics/provider';
import { parseTimedLyrics } from '../src/rebuild/lyrics/parse';
import { lyricText } from '../src/rebuild/lyrics/identity';
import { READING_SONG_EXCERPTS, pronunciationLetters, type ReadingSongExcerpt } from './fixtures/reading-song-excerpts';

const maximumRequests=24,maximumBytes=4*1024*1024,maximumResponseBytes=1024*1024;
const refresh=process.argv.includes('--refresh');
const totalSignal=AbortSignal.timeout(180000);
let requests=0,bytes=0;
const traffic:unknown[]=[];
const script:Record<ReadingLanguage,RegExp>={ja:/[\p{Script=Hiragana}\p{Script=Katakana}]/u,zh:/\p{Script=Han}/u,ko:/\p{Script=Hangul}/u,ru:/\p{Script=Cyrillic}/u,uk:/\p{Script=Cyrillic}/u,el:/\p{Script=Greek}/u,hi:/\p{Script=Devanagari}/u,ar:/\p{Script=Arabic}/u};
const rawPath=(song:ReadingSongExcerpt)=>song.capture?`.local/reading-live-probe-${song.capture}.json`:`.local/reading-live-${song.id}.json`;

async function readCapture(path:string,url:string,id:string) {
 if(!refresh) {
  const saved=await stat(path).catch(()=>undefined);
  if(saved&&Date.now()-saved.mtimeMs<24*3600000) {
   const data=JSON.parse(await readFile(path,'utf8'));
   traffic.push({id,url,replayedCapture:true,capturedAt:saved.mtime.toISOString(),bytes:saved.size});
   return {data,capturedAt:saved.mtime.toISOString(),replayedCapture:true};
  }
 }
 if(requests>=maximumRequests)throw new RangeError('Live reading audit reached its request cap');
 totalSignal.throwIfAborted();requests++;
 const signal=AbortSignal.any([totalSignal,AbortSignal.timeout(15000)]);
 const response=await fetch(url,{signal,headers:{'User-Agent':'SakuraReadingAudit/1.0 (read-only lyric quality verification)'}});
 if(Number(response.headers.get('content-length'))>maximumResponseBytes){await response.body?.cancel();throw new RangeError('Provider response exceeds audit byte cap');}
 if(!response.body)throw new Error('Provider returned an empty body');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];
 let responseBytes=0;
 try {
  for(;;) {
   const value=await reader.read();if(value.done)break;
   responseBytes+=value.value.byteLength;bytes+=value.value.byteLength;
   if(responseBytes>maximumResponseBytes||bytes>maximumBytes)throw new RangeError('Live reading audit reached its byte cap');
   chunks.push(value.value);
  }
 } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
 const body=Buffer.concat(chunks).toString('utf8');
 const capturedAt=new Date().toISOString();
 traffic.push({id,url,status:response.status,bytes:responseBytes,capturedAt});
 await writeFile(path,body);
 if(!response.ok)throw new Error(`Provider returned HTTP ${response.status}`);
 return {data:JSON.parse(body),capturedAt,replayedCapture:false};
}

async function providerPool(song:ReadingSongExcerpt) {
 const url=`https://lrclib.net/api/search?${new URLSearchParams({track_name:song.queryTitle||song.title,artist_name:song.queryArtist||song.artist})}`;
 return readCapture(rawPath(song),url,song.id);
}

async function catalogue(song:ReadingSongExcerpt) {
 const artist=song.artists.find(name=>/^[\x20-\x7f]+$/.test(name))||song.queryArtist||song.artist;
 const title=song.id==='gruppa-krovi'?'Gruppa Krovi':song.id==='chervona-ruta'?'Chervona Ruta':song.queryTitle||song.title;
 const url=`https://api.deezer.com/search?${new URLSearchParams({q:`${title} ${artist}`,limit:'10'})}`;
 const path=song.id==='tian-mi-mi'?'.local/reading-live-probe-catalogue.json':`.local/reading-live-catalogue-${song.id}.json`;
 const pool=await readCapture(path,url,'catalogue:'+song.id);
 const data=pool.data as {data?:{id:number;title:string;duration:number;artist:{name:string};album:{title:string}}[]};
 const titles=[song.title,song.queryTitle,...song.alternateTitles||[]].filter((value):value is string=>Boolean(value)).map(lyricText);
 const artists=[song.artist,...song.artists].map(lyricText);
 return data.data?.find(track=>titles.includes(lyricText(track.title))&&artists.includes(lyricText(track.artist.name)));
}

function sourceLines(track:LrcLibTrack) {
 return track.syncedLyrics?.trim()?parseTimedLyrics(track.syncedLyrics):track.plainLyrics!.split(/\r?\n/).map((text,index)=>({text,start:index,end:index+1}));
}
function quality(actual:string,song:ReadingSongExcerpt) {
 const correct=song.mode==='pinyin'||song.mode==='script'?actual===song.expected:pronunciationLetters(actual)===pronunciationLetters(song.expected);
 return correct&&!(song.id==='lemon'&&/\bdesho\s+u\b/.test(actual));
}
const sourceText=(text:string)=>text.normalize('NFKD').replace(/[\s\p{P}\p{M}]/gu,'').toLowerCase();
function liveExcerpt(readings:readonly {text:string;romanized:string}[],song:ReadingSongExcerpt) {
 const excerpts=[song.text,...song.alternateTexts||[]].map(sourceText);
 for(let index=0;index<readings.length;index++) {
  for(let length=1;length<=4&&index+length<=readings.length;length++) {
   const span=readings.slice(index,index+length);
   if(!excerpts.some(text=>sourceText(span.map(line=>line.text).join(' ')).includes(text)))continue;
   const actual=span.map(line=>line.romanized).join(' ');
   const correct=song.mode==='pinyin'||song.mode==='script'?actual.replace(/\s+/g,' ').includes(song.expected):pronunciationLetters(actual).includes(pronunciationLetters(song.expected));
   return {correct:correct&&!(song.id==='lemon'&&/\bdesho\s+u\b/.test(actual))};
  }
 }
 return undefined;
}

async function audit(song:ReadingSongExcerpt) {
 const [excerpt]=await romanizeLyricLines([{text:song.text,start:1000,end:2000}],song.language);
 const excerptCorrect=quality(excerpt.romanized,song);
 const result:Record<string,unknown>={id:song.id,title:song.title,artist:song.artist,language:song.language,engine:readingEngine(song.language),independentExcerpt:{text:song.text,expected:song.expected,actual:excerpt.romanized,mode:song.mode,correct:excerptCorrect,languageDetected:lyricReadingLanguage(song.text,song.hintRequired?song.language:undefined),hintRequired:Boolean(song.hintRequired)}};
 try {
  const recording=await catalogue(song).catch(()=>undefined);
  if(recording)result.catalogue={provider:'deezer',id:recording.id,title:recording.title,artist:recording.artist.name,durationSeconds:recording.duration};
  const pool=await providerPool(song);
  if(!Array.isArray(pool.data))throw new Error('Provider did not return a candidate array');
  const candidates=(pool.data as LrcLibTrack[]).filter(track=>!track.instrumental&&script[song.language].test(track.syncedLyrics||track.plainLyrics||''));
  const match=selectLyricsCandidate({title:song.title,artist:song.artist,artists:song.artists,alternateTitles:song.alternateTitles,language:song.language,durationSeconds:recording?.duration,album:recording?.album.title},candidates);
  if(match.status!=='matched'){result.live={status:'unavailable',reason:match.reason,candidates:pool.data.length,sourceScriptCandidates:candidates.length,capturedAt:pool.capturedAt,replayedCapture:pool.replayedCapture};return result;}
  const lines=sourceLines(match.track);
  const detected=lyricReadingLanguage(lines.map(line=>line.text).join('\n'),song.hintRequired?song.language:undefined);
  const readings=await romanizeLyricLines(lines,song.language);
  const exact=liveExcerpt(readings,song);
  const preserved=readings.every((line,index)=>line.text===lines[index].text&&line.start===lines[index].start&&line.end===lines[index].end);
  result.live={status:'matched',provider:'lrclib',providerId:match.track.id,providerTitle:match.track.trackName,providerArtist:match.track.artistName,durationSeconds:match.track.duration,timing:match.track.syncedLyrics?'synced':'plain',lines:lines.length,languageDetected:detected,textAndTimingPreserved:preserved,unconvertedScriptLines:readings.filter(line=>script[song.language].test(line.romanized)).length,sourceSha256:createHash('sha256').update(JSON.stringify(lines)).digest('hex'),capturedAt:pool.capturedAt,replayedCapture:pool.replayedCapture,independentExcerptFound:Boolean(exact),...(exact?{liveExcerptCorrect:exact.correct}:{}),identityScope:recording?'Live Deezer title/artist/duration with Sakura provider identity and edition gates.':'Sakura title/artist/edition gates; catalogue did not supply an independently matched recording duration.'};
  await writeFile(`.local/reading-live-${song.id}-converted.json`,JSON.stringify({song:song.id,source:match.track,readings},null,2));
 } catch(error) {result.live={status:'unavailable',reason:error instanceof Error?error.message:String(error)};}
 return result;
}

async function main() {
 await mkdir('.local',{recursive:true});
 const results:Record<string,unknown>[]=[];
 // Two workers keep provider traffic bounded and avoid a cold dictionary flood.
 let next=0;
 await Promise.all(Array.from({length:2},async()=>{while(next<READING_SONG_EXCERPTS.length){const song=READING_SONG_EXCERPTS[next++];const result=await audit(song);results.push(result);console.log(JSON.stringify({id:song.id,excerptCorrect:(result.independentExcerpt as {correct:boolean}).correct,live:result.live}));}}));
 results.sort((a,b)=>READING_SONG_EXCERPTS.findIndex(song=>song.id===a.id)-READING_SONG_EXCERPTS.findIndex(song=>song.id===b.id));
 const excerptFailures=results.filter(result=>!(result.independentExcerpt as {correct:boolean}).correct);
 const failed=results.filter(result=>!(result.independentExcerpt as {correct:boolean}).correct||(result.live as {status:string;liveExcerptCorrect?:boolean;languageDetected?:string;textAndTimingPreserved?:boolean}).liveExcerptCorrect===false);
 const report={checkedAt:new Date().toISOString(),scope:'Read-only live Deezer/LRCLIB original lyric captures and independently chosen short song excerpts; no audio/account/publication requests.',limits:{maximumRequests,maximumBytes,maximumResponseBytes,totalTimeoutMs:180000},traffic:{newRequests:requests,newBytes:bytes,requests:traffic},summary:{songs:results.length,excerptChecksPassed:results.length-excerptFailures.length,liveMatched:results.filter(result=>(result.live as {status:string}).status==='matched').length,liveExcerptChecksPassed:results.filter(result=>(result.live as {liveExcerptCorrect?:boolean}).liveExcerptCorrect===true).length,correctnessFailures:failed.map(result=>result.id)},cases:results,limitations:['A live response proves provider text was processed, not that every word of a full song has a manually reviewed reading.','Short excerpt pronunciation expectations are independent of the engine; Hindi/Greek/Cyrillic word spacing and macrons normalize for comparison.','Unvowelled Arabic checks script transliteration only; unwritten vowels and dialect cannot be recovered from consonants.','Cyrillic alone cannot always distinguish Ukrainian from Russian; the Ukrainian excerpt requires a verified language hint.','Mandarin Pinyin does not supply Cantonese readings or all singer-specific poetic pronunciations.','Provider matches use known title/artist aliases and edition gates; externally matched Deezer recordings additionally supply the duration gate.']};
 await writeFile('.local/reading-live-report.json',JSON.stringify(report,null,2));
 await mkdir('docs/rebuild',{recursive:true});
 await writeFile('docs/rebuild/transliteration-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:'docs/rebuild/transliteration-report.json',summary:report.summary,newRequests:requests,newBytes:bytes}));
 if(failed.length)process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
