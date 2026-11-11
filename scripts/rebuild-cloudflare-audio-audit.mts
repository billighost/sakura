import 'dotenv/config';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {SourceAudioTransport} from '../src/rebuild/server/gateway';
import {inspectFullAudio} from '../src/rebuild/server/audio-inspection';
import {assessAudioCandidate} from '../src/rebuild/core/matching';
import type {CanonicalRecording} from '../src/rebuild/core/types';
import type {StoredAudioAsset} from '../src/rebuild/server/contracts';

const directory='.local/cloudflare-full-save';mkdirSync(directory,{recursive:true});
interface AuditFile {target:string;documentId:string|null|undefined;expectedBytes:number;receivedBytes:number;verified:boolean;sha256?:string;measured?:{container:string;codec:string;durationMs:number};decodedEntireFile?:boolean}
interface AuditLedger {limitBytes:number;receivedBytes:number;files:AuditFile[]}
const path=directory+'/ledger.json',limit=50*1024*1024;
const ledger:AuditLedger=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{limitBytes:limit,receivedBytes:0,files:[]};
if(ledger.limitBytes!==limit)throw new Error('The existing audit ledger has another cap; do not reset it.');
const save=()=>writeFileSync(path,JSON.stringify(ledger,null,2));
const report=JSON.parse(readFileSync('.local/download-root-audit/cloudflare-production-discovery.json','utf8')).report;
const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:'https://sakura-audio.bb2010ng.workers.dev',secret:process.env.WORKER_SECRET!,chatScope:process.env.TELEGRAM_BOT_USERNAME!}});
for(const item of report){
 if(item.result.status!=='ready'){console.log(item.target,'source still unavailable');continue;}
 const source:StoredAudioAsset=item.result.asset,recording:CanonicalRecording={...item.recording,...(item.result.verifiedMetadata?{metadata:item.result.verifiedMetadata}:{})};
 const filename=directory+'/'+item.target+'.mp3';
 const documentId=source.locator.kind==='telegram-worker'?source.locator.documentId:null;
 const previous=ledger.files.find(row=>row.target===item.target&&row.documentId===documentId&&row.verified);
 if(previous&&existsSync(filename)){console.log(item.target,'reusing verified complete file');continue;}
 if(ledger.receivedBytes+source.sizeBytes>limit)throw new Error('The audit transfer cap would be exceeded.');
 const attempt:AuditFile={target:item.target,documentId,expectedBytes:source.sizeBytes,receivedBytes:0,verified:false};ledger.files.push(attempt);save();
 const parts:Buffer[]=[];
 // Exercise resumption and exact signed-document ranges, then validate the
 // whole saved artifact. Each byte is transferred once in the successful run.
 for(const range of ['bytes=0-4095','bytes=4096-']){
  const response=await transport.open(source,range,AbortSignal.timeout(120000));
  if(response.status!==206||!response.body)throw new Error('Ranged delivery did not start');
  for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){
   ledger.receivedBytes+=chunk.byteLength;attempt.receivedBytes+=chunk.byteLength;save();
   if(ledger.receivedBytes>limit||attempt.receivedBytes>source.sizeBytes)throw new Error('Audio transfer exceeded its allowed size');
   parts.push(Buffer.from(chunk));
  }
 }
 const bytes=Buffer.concat(parts);if(bytes.length!==source.sizeBytes)throw new Error('Saved file was incomplete');
 const measured=await inspectFullAudio(bytes,recording,source);writeFileSync(filename,bytes);
 const decoder=spawnSync('ffmpeg',['-nostdin','-v','error','-xerror','-i',filename,'-f','null','-'],{encoding:'utf8',windowsHide:true});
 if(decoder.status!==0)throw new Error('Full codec decoding failed: '+String(decoder.stderr||decoder.error).slice(0,300));
 if(!assessAudioCandidate(recording,source.candidate).acceptable)throw new Error('Saved audio did not match the selected recording');
 attempt.sha256=createHash('sha256').update(bytes).digest('hex');attempt.measured=measured;attempt.decodedEntireFile=true;attempt.verified=true;save();
 console.log(item.target,'complete:',bytes.length,'bytes;',measured.durationMs,'ms; codec decoding passed');
}
console.log('Audit received',ledger.receivedBytes,'of',limit,'allowed audio bytes.');
