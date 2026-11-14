/** Bounded read-only lyric/provider audit. Full provider data stays in .local. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { lyricReadingLanguage, readingEngine, READING_SCRIPTS } from '../src/rebuild/lyrics/language';
import { romanizeLyricLines } from '../src/rebuild/lyrics/readings';
import { selectLyricsCandidate, type LrcLibTrack } from '../src/rebuild/lyrics/provider';
import { parseTimedLyrics, type TimedLyric } from '../src/rebuild/lyrics/parse';
import { lyricEdition, lyricText, lyricTitleVariants } from '../src/rebuild/lyrics/identity';
import { READING_SONG_EXCERPTS, pronunciationLetters, type ReadingSongExcerpt } from './fixtures/reading-song-excerpts';

const maximumRequests=96,maximumBytes=8*1024*1024,maximumResponseBytes=1024*1024;
const refresh=process.argv.includes('--refresh');
const totalTimeoutMs=240000,totalSignal=AbortSignal.timeout(totalTimeoutMs);
let requests=0,bytes=0;
const traffic:unknown[]=[];
const script=READING_SCRIPTS;
const rawPath=(song:ReadingSongExcerpt)=>song.capture?`.local/reading-live-probe-${song.capture}.json`:`.local/reading-live-${song.id}.json`;

async function readCapture(path:string,url:string,id:string) {
 if(!refresh) {
  const saved=await stat(path).catch(()=>undefined);
  const metadata=await readFile(path+'.meta.json','utf8').then(raw=>JSON.parse(raw) as {url:string;capturedAt:string;status:number;sha256:string}).catch(()=>undefined);
  if(saved&&metadata?.url===url&&metadata.status>=200&&metadata.status<300&&Date.now()-Date.parse(metadata.capturedAt)<24*3600000) {
   const raw=await readFile(path,'utf8');
   if(createHash('sha256').update(raw).digest('hex')===metadata.sha256) {
    const data=JSON.parse(raw);
    traffic.push({id,url,replayedCapture:true,capturedAt:metadata.capturedAt,bytes:saved.size});
    return {data,capturedAt:metadata.capturedAt,replayedCapture:true};
   }
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
 await writeFile(path+'.meta.json',JSON.stringify({url,capturedAt,status:response.status,sha256:createHash('sha256').update(body).digest('hex')}));
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
 const url=song.catalogueId?`https://api.deezer.com/track/${song.catalogueId}`:`https://api.deezer.com/search?${new URLSearchParams({q:`${title} ${artist}`,limit:'10'})}`;
 const path=song.catalogueId?`.local/reading-live-catalogue-track-${song.catalogueId}.json`:song.id==='tian-mi-mi'?'.local/reading-live-probe-catalogue.json':`.local/reading-live-catalogue-${song.id}.json`;
 const pool=await readCapture(path,url,'catalogue:'+song.id);
 type Track={id:number;title:string;duration:number;artist:{name:string};contributors?:{name:string;role:string}[];album:{title:string}};
 const data=pool.data as {data?:Track[]}&Partial<Track>;
 const titles=[song.title,song.queryTitle,...song.alternateTitles||[]].filter((value):value is string=>Boolean(value)).flatMap(lyricTitleVariants).map(lyricText);
 const artists=[song.artist,...song.artists].map(lyricText);
 const candidates=song.catalogueId?[data as Track]:Array.isArray(data.data)?data.data:[];
 return candidates.find(track=>Number.isSafeInteger(track.id)&&track.id>0&&(!song.catalogueId||track.id===song.catalogueId)&&Number.isFinite(track.duration)&&track.duration>0
  && typeof track.artist?.name==='string'&&typeof track.album?.title==='string'
  && typeof track.title==='string'&&titles.some(title=>lyricTitleVariants(track.title).some(variant=>lyricText(variant)===title))
  && JSON.stringify(lyricEdition(track.title))===JSON.stringify(lyricEdition(song.title))
  && [track.artist.name,...(Array.isArray(track.contributors)?track.contributors:[]).filter(credit=>credit.role==='Main').map(credit=>credit.name)].some(name=>typeof name==='string'&&artists.includes(lyricText(name))));
}

function sourceLines(track:LrcLibTrack):TimedLyric[] {
 return track.syncedLyrics?.trim()?parseTimedLyrics(track.syncedLyrics):track.plainLyrics!.split(/\r?\n/).map((text,index)=>({text,start:index,end:index+1}));
}
function quality(actual:string,song:ReadingSongExcerpt) {
 const correct=song.mode==='pinyin'||song.mode==='script'?actual.normalize('NFC')===song.expected.normalize('NFC'):pronunciationLetters(actual)===pronunciationLetters(song.expected);
 return correct&&!(song.id==='lemon'&&/\bdesho\s+u\b/.test(actual));
}
// Ignore source punctuation/case, never native vowel signs or nasal marks.
const sourceText=(text:string)=>text.normalize('NFC').replace(/[\s\p{P}\u200c\u200d]/gu,'').toLowerCase();
// Commas can be absent from provider text. Ejective apostrophes and all vowel
// diacritics are phonemic reading evidence and must survive this comparison.
const writtenReading=(text:string)=>text.normalize('NFC').toLowerCase().replace(/(?!['’])\p{P}/gu,' ').replace(/\s+/gu,' ').trim();
function liveExcerpt(readings:readonly {text:string;romanized:string}[],song:ReadingSongExcerpt) {
 const excerpts=[song.text,...song.alternateTexts||[]].map(sourceText);
 for(let index=0;index<readings.length;index++) {
  for(let length=1;length<=4&&index+length<=readings.length;length++) {
   const span=readings.slice(index,index+length);
   if(!excerpts.some(text=>sourceText(span.map(line=>line.text).join(' ')).includes(text)))continue;
   const actual=span.map(line=>line.romanized).join(' ');
   const correct=song.mode==='pinyin'||song.mode==='script'?writtenReading(actual).includes(writtenReading(song.expected)):pronunciationLetters(actual).includes(pronunciationLetters(song.expected));
   return {correct:correct&&!(song.id==='lemon'&&/\bdesho\s+u\b/.test(actual))};
  }
 }
 return undefined;
}

async function audit(song:ReadingSongExcerpt) {
 const [excerpt]=await romanizeLyricLines([{text:song.text,start:1000,end:2000}],song.language);
 const excerptCorrect=quality(excerpt.romanized,song);
 const result:Record<string,unknown>={id:song.id,title:song.title,artist:song.artist,language:song.language,engine:readingEngine(song.language),independentExcerpt:{text:song.text,expected:song.expected,actual:excerpt.romanized,mode:song.mode,correct:excerptCorrect,languageDetected:lyricReadingLanguage(song.text,song.hintRequired?song.language:undefined),hintRequired:Boolean(song.hintRequired),...(song.references?{references:song.references}:{})}};
 try {
  const recording=await catalogue(song).catch(error=>{result.catalogue={status:'unavailable',reason:error instanceof Error?error.message:String(error)};return undefined;});
  if(recording)result.catalogue={status:'matched',provider:'deezer',id:recording.id,title:recording.title,artist:recording.artist.name,contributors:recording.contributors?.filter(credit=>credit.role==='Main').map(credit=>credit.name),durationSeconds:recording.duration};
  else if(!result.catalogue)result.catalogue={status:'unavailable',reason:'No independently matched original title, artist/credited contributor and edition in the bounded catalogue response.'};
  const pool=await providerPool(song);
  if(!Array.isArray(pool.data))throw new Error('Provider did not return a candidate array');
  const candidates=(pool.data as LrcLibTrack[]).filter(track=>!track.instrumental&&script[song.language].test(track.syncedLyrics||track.plainLyrics||''));
  const match=selectLyricsCandidate({title:song.title,artist:song.artist,artists:song.artists,alternateTitles:song.alternateTitles,language:song.language,durationSeconds:recording?.duration,album:recording?.album.title},candidates);
  if(match.status!=='matched'){result.live={status:'unavailable',reason:match.reason,candidates:pool.data.length,sourceScriptCandidates:candidates.length,capturedAt:pool.capturedAt,replayedCapture:pool.replayedCapture};return result;}
  const lines=sourceLines(match.track);
  const detected=lyricReadingLanguage(lines.map(line=>line.text).join('\n'),song.hintRequired?song.language:undefined);
  const readings=await romanizeLyricLines(lines,song.language);
  const exact=liveExcerpt(readings,song);
  const preserved=readings.every((line,index)=>line.text===lines[index].text&&line.start===lines[index].start&&line.end===lines[index].end&&JSON.stringify(line.words)===JSON.stringify(lines[index].words));
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
 const failed=results.filter(result=>{
  const live=result.live as {status:string;liveExcerptCorrect?:boolean;textAndTimingPreserved?:boolean;languageDetected?:string|null;unconvertedScriptLines?:number};
  return !(result.independentExcerpt as {correct:boolean}).correct||live.liveExcerptCorrect===false||live.textAndTimingPreserved===false
   ||live.status==='matched'&&(live.languageDetected!==result.language||Boolean(live.unconvertedScriptLines));
 });
 const byLanguage=Object.fromEntries([...new Set(READING_SONG_EXCERPTS.map(song=>song.language))].map(language=>{
  const cases=results.filter(result=>result.language===language);
  return [language,{excerpts:cases.length,excerptChecksPassed:cases.filter(result=>(result.independentExcerpt as {correct:boolean}).correct).length,liveMatched:cases.filter(result=>(result.live as {status:string}).status==='matched').length,liveExcerptChecksPassed:cases.filter(result=>(result.live as {liveExcerptCorrect?:boolean}).liveExcerptCorrect===true).length}];
 }));
 const report={checkedAt:new Date().toISOString(),scope:'Read-only live Deezer/LRCLIB original lyric captures and independently checked short song excerpts; no audio/account/publication requests.',limits:{maximumRequests,maximumBytes,maximumResponseBytes,totalTimeoutMs},traffic:{newRequests:requests,newBytes:bytes,requests:traffic},summary:{songs:results.length,excerptChecksPassed:results.length-excerptFailures.length,liveMatched:results.filter(result=>(result.live as {status:string}).status==='matched').length,liveExcerptChecksPassed:results.filter(result=>(result.live as {liveExcerptCorrect?:boolean}).liveExcerptCorrect===true).length,correctnessFailures:failed.map(result=>result.id),byLanguage},cases:results,limitations:['A live response proves provider text was processed, not that every word of a full song has a manually reviewed reading.','Independent ISO/song excerpt checks preserve vowel length, retroflex letters, nasalization and Georgian ejective apostrophes; live comparisons allow source case/punctuation differences only.','Unvowelled Arabic checks script transliteration only; unwritten vowels and dialect cannot be recovered from consonants.','Shared Cyrillic and Devanagari require compatible trusted hints or distinguishing text evidence; ambiguous passages stay original.','Telugu/Kannada/Malayalam/Odia use ISO 15919 with written-script limits. Odia a denotes /ɔ/; Sanskrit conjunct and loan readings can differ.','Malayalam bare final virama, old ambiguous digraphs and exceptional singer/dialect voicing are not guessed; atomic chillus and explicitly written half-u are handled.','Mandarin Pinyin does not supply Cantonese readings or all singer-specific poetic pronunciations.','Provider matches use known title/artist aliases and edition gates; externally matched Deezer recordings additionally supply the duration gate.']};
 report.limitations.push('Tamil uses a conventional hybrid guide: written vowel/consonant distinctions, supported contextual voicing, 62 exact reviewed initial choices and 1,123 strictly filtered Dakshina initial preferences. Other loans, compounds, c/s choices, dialects and singer elisions retain conservative spelling readings; full-song processing does not certify every sung word.');
 await writeFile('.local/reading-live-report.json',JSON.stringify(report,null,2));
 await mkdir('docs/rebuild',{recursive:true});
 await writeFile('docs/rebuild/transliteration-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:'docs/rebuild/transliteration-report.json',summary:report.summary,newRequests:requests,newBytes:bytes}));
 if(failed.length)process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
