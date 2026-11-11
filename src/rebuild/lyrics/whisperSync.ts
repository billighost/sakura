import type { TimedLyric } from "./parse";

export const WHISPER_SYNC_ENGINE="whisper-small-en-v1";
export interface RecognizedWord {text:string;start:number;end:number;probability?:number}
export interface WhisperSyncResult {lines:TimedLyric[];confidence:number;recognizedWordCoverage:number;engine:string}
export class LyricAlignmentError extends Error {
  constructor(message:string,readonly coverage?:number,readonly uncertainLines?:number){super(message);}
}

const normalize=(word:string)=>word.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z]/g,"");
/** Align original provider text to independently recognized, timed audio words.
 * A missing line or uncertain boundary refuses the whole result; we never
 * invent timestamps for lyrics the audio model could not locate.
 */
export function alignWhisperLyrics(lines:readonly TimedLyric[],recognized:readonly RecognizedWord[],durationSeconds:number):WhisperSyncResult {
  if(!lines.length||lines.length>400||lines.reduce((sum,line)=>sum+line.text.length,0)>10_000||recognized.length>2500||!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>600)throw new LyricAlignmentError("This song exceeds the auto-sync limit.");
  if(lines.some(line=>/[^A-Za-z'’‘♪♫♬\p{P}\p{Z}\s]/u.test(line.text.normalize("NFKD").replace(/\p{M}/gu,""))))throw new LyricAlignmentError("Auto sync currently supports English lyrics.");
  // Whisper can emit zero-duration uncertain words; those have no timing
  // evidence and cannot serve as lyric anchors.
  const actual=recognized.filter(word=>normalize(word.text)&&word.end!==word.start);
  if(actual.some((word,index)=>!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<=word.start||word.end>durationSeconds+1||(index>0&&word.start<actual[index-1].start)||typeof word.probability!=="number"||!Number.isFinite(word.probability)||word.probability<0||word.probability>1))throw new LyricAlignmentError("The worker returned invalid word timings or confidence.");
  const expected=lines.flatMap((line,index)=>[...line.text.matchAll(/[\p{L}]+(?:['’‘][\p{L}]+)*/gu)].map(word=>({word:normalize(word[0]),line:index,offset:word.index!,length:word[0].length})));
  if(!expected.length||expected.length>2000||!actual.length)throw new LyricAlignmentError("No clear English vocals were found for these lyrics.");
  // Monotonic sequence mapping keeps repeated choruses tied to separate
  // occurrences and excludes extra recognized words or hallucinated passages.
  const rows=Array.from({length:expected.length+1},()=>new Uint16Array(actual.length+1));
  for(let i=1;i<=expected.length;i++)for(let j=1;j<=actual.length;j++)rows[i][j]=expected[i-1].word===normalize(actual[j-1].text)?rows[i-1][j-1]+1:Math.max(rows[i-1][j],rows[i][j-1]);
  let i=expected.length,j=actual.length;
  const mapping=new Map<number,number>();
  while(i&&j){
    if(expected[i-1].word===normalize(actual[j-1].text)){mapping.set(i-1,j-1);i--;j--;}
    else if(rows[i-1][j]>=rows[i][j-1])i--;else j--;
  }
  const coverage=mapping.size/expected.length;
  let uncertain=0;
  const prepared=lines.map((line,lineIndex)=>{
    const tokens=expected.flatMap((word,index)=>word.line===lineIndex?[{...word,index,actual:mapping.get(index)}]:[]);
    if(!tokens.length)return {...line,start:0,end:0,words:[]};
    const matches=tokens.filter((token):token is typeof token&{actual:number}=>token.actual!==undefined);
    const first=matches[0],last=matches.at(-1);
    // Both ends must match actual words. Per-line coverage alone can falsely
    // anchor an entire verse to an incidental 'I' or a later repeated chorus.
    const anchored=first?.index===tokens[0].index&&last?.index===tokens.at(-1)!.index;
    const start=first?actual[first.actual].start:0,end=last?actual[last.actual].end:0;
    const lowConfidence=matches.some(token=>actual[token.actual].probability!==undefined&&actual[token.actual].probability!<.2);
    if(!anchored||matches.length/tokens.length<.6||end-start>40||end<=start||lowConfidence)uncertain++;
    // Word timings are shown only when every source word has a direct match.
    const words=matches.length===tokens.length?tokens.map((token,index)=>{
      const timed=actual[token.actual!];
      return {text:line.text.slice(index===0?0:token.offset,index===tokens.length-1?line.text.length:tokens[index+1].offset),start:timed.start,end:timed.end};
    }):undefined;
    return {...line,start,end,...(words?{words}:{words:undefined})};
  });
  if(coverage<.7||uncertain)throw new LyricAlignmentError("Some words or line boundaries could not be heard clearly. Your original plain lyrics have been kept.",coverage,uncertain);
  const result=prepared.map((line,index)=>{
    if(/[A-Za-z]/.test(line.text.normalize("NFKD")))return line;
    const before=prepared.slice(0,index).filter(item=>/[A-Za-z]/.test(item.text)).at(-1);
    const after=prepared.slice(index+1).find(item=>/[A-Za-z]/.test(item.text));
    return {...line,start:before?.end||0,end:after?.start??durationSeconds,words:[]};
  });
  if(result.some((line,index)=>index>0&&line.start<result[index-1].start))throw new LyricAlignmentError("The worker could not establish a consistent lyric order.",coverage);
  const probabilities=[...mapping.values()].flatMap(index=>actual[index].probability===undefined?[]:[actual[index].probability!]);
  const confidence=probabilities.length?probabilities.reduce((sum,value)=>sum+value,0)/probabilities.length:coverage;
  return {lines:result,engine:WHISPER_SYNC_ENGINE,confidence,recognizedWordCoverage:coverage};
}
