import {createHash} from "node:crypto";
import {fetchAudioHeaders} from "../core/streaming";
import {assessAudioCandidate} from "../core/matching";
import type {CanonicalRecording} from "../core/types";
import type {StoredAudioAsset} from "./contracts";
import type {AudioTransport} from "./gateway";
import type {RecordingIngestor} from "./ingestion";
import {readMetadataJson} from "./providers";
import {supportedAudioMime,normalizedAudioMime} from "./input";

const MAX_BYTES=120*1024*1024;
export class AudioPromotionError extends Error {
 constructor(readonly reason:"quota"|"provider"|"integrity"|"size"|"busy",message:string){super(message);this.name="AudioPromotionError";}
}
export interface CdnUsage {checkedAt:string;plan?:string;credits?:{usage:number;limit:number;usedPercent:number};storageBytes?:number;bandwidthBytes?:number}
export interface AudioPublisher {publish(recording:CanonicalRecording,source:StoredAudioAsset,bytes:Buffer,signal?:AbortSignal):Promise<StoredAudioAsset>}

/** Complete bytes and digest are checked before publishing and after CDN delivery.
 * This is separate from immediate playback: unpublished sources remain preparing. */
export async function completeAudio(response:Response,expectedBytes:number,signal?:AbortSignal):Promise<Buffer>{
 if(response.status!==200||!response.body||!supportedAudioMime(response.headers.get("Content-Type")||""))throw new AudioPromotionError("integrity","Full audio delivery was not valid");
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||expectedBytes>MAX_BYTES){await response.body.cancel();throw new AudioPromotionError("size","This audio exceeds the configured full-file preparation limit");}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let received=0;
 try{while(true){signal?.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined;
  const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AudioPromotionError("provider","Audio preparation stopped receiving bytes")),15000);})]).finally(()=>clearTimeout(timer));
  if(chunk.done)break;received+=chunk.value.byteLength;if(received>expectedBytes)throw new AudioPromotionError("integrity","Full audio delivery exceeded its verified size");parts.push(chunk.value);
 }}catch(error){await reader.cancel(error).catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(received!==expectedBytes)throw new AudioPromotionError("integrity","Full audio delivery ended before its verified size");
 return Buffer.concat(parts,received);
}
function digest(bytes:Buffer){return createHash("sha256").update(bytes).digest("hex");}
function cdnAssetId(recordingId:string,sha256:string){const hash=createHash("sha256").update("sakura-v2-cdn:"+recordingId+":"+sha256).digest("hex").slice(0,32).split("");hash[12]="5";hash[16]="8";const value=hash.join("");return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;}

/** Existing configured Cloudinary account only. No upgrade or new service is created. */
export class CloudinaryAudioPublisher implements AudioPublisher {
 private usageCache?:{expires:number;value:CdnUsage};
 constructor(private readonly configuration:{cloudName:string;apiKey:string;apiSecret:string},private readonly fetcher:typeof fetch=fetch){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(configuration.cloudName)||!configuration.apiKey||!configuration.apiSecret)throw new Error("Cloudinary audio configuration is incomplete");
 }
 async usage(signal?:AbortSignal):Promise<CdnUsage>{
  if(this.usageCache&&this.usageCache.expires>Date.now())return structuredClone(this.usageCache.value);
  const authorization="Basic "+Buffer.from(this.configuration.apiKey+":"+this.configuration.apiSecret).toString("base64");
  const response=await fetchAudioHeaders(`https://api.cloudinary.com/v1_1/${this.configuration.cloudName}/usage`,{signal,headerTimeoutMs:8000,redirect:"error",headers:{Authorization:authorization}},this.fetcher);
  if(!response.ok){await response.body?.cancel();throw new AudioPromotionError("provider","CDN usage information is unavailable");}
  const raw=await readMetadataJson(response) as Record<string,unknown>,credits=raw.credits as Record<string,unknown>|undefined;
  const usage=Number(credits?.usage),limit=Number(credits?.limit),usedPercent=Number(credits?.used_percent);
  const value:CdnUsage={checkedAt:new Date().toISOString(),...(typeof raw.plan==="string"?{plan:raw.plan}:{}),...(Number.isFinite(usage)&&Number.isFinite(limit)&&limit>0?{credits:{usage,limit,usedPercent:Number.isFinite(usedPercent)?usedPercent:usage/limit*100}}:{})};
  const storage=Number((raw.storage as Record<string,unknown>|undefined)?.usage),bandwidth=Number((raw.bandwidth as Record<string,unknown>|undefined)?.usage);if(Number.isFinite(storage))value.storageBytes=storage;if(Number.isFinite(bandwidth))value.bandwidthBytes=bandwidth;
  this.usageCache={expires:Date.now()+5*60000,value};return structuredClone(value);
 }
 async publish(recording:CanonicalRecording,source:StoredAudioAsset,bytes:Buffer,signal?:AbortSignal):Promise<StoredAudioAsset>{
  if(source.ownerAccountId!==null||source.recordingId!==recording.recordingId||source.state!=="ready"||source.candidate.audioKind!=="full"||!source.sha256||bytes.length!==source.sizeBytes||digest(bytes)!==source.sha256||!assessAudioCandidate(recording,source.candidate).acceptable)throw new AudioPromotionError("integrity","Only checksum-verified full catalog audio may be published");
  let usage:CdnUsage|undefined;try{usage=await this.usage(signal);}catch(error){if(signal?.aborted)throw error;/* The upload API still enforces the provider's quota if usage lookup is unavailable. */}
  if(usage?.credits&&usage.credits.usage>=usage.credits.limit)throw new AudioPromotionError("quota","The existing CDN account has reached its credit allowance");
  const publicId=`sakura/v2/audio/${recording.recordingId}/${source.sha256}`,timestamp=String(Math.floor(Date.now()/1000));
  const extensions:Record<string,string>={"audio/mpeg":"mp3","audio/mp3":"mp3","audio/mp4":"m4a","audio/aac":"aac","audio/flac":"flac","audio/x-flac":"flac","audio/ogg":"ogg","audio/opus":"opus","audio/wav":"wav","audio/x-wav":"wav","audio/webm":"webm"};
  const extension=extensions[normalizedAudioMime(source.mimeType)];if(!extension)throw new AudioPromotionError("integrity","The source audio container is unsupported");
  let raw:Record<string,unknown>|undefined;
  // A previous instance may have uploaded successfully before its delivery
  // verification timed out. Reuse that immutable object without uploading again.
  try{const existing=await fetchAudioHeaders(`https://api.cloudinary.com/v1_1/${this.configuration.cloudName}/resources/video/upload/${encodeURIComponent(publicId)}`,{signal,headerTimeoutMs:8000,redirect:"error",headers:{Authorization:"Basic "+Buffer.from(this.configuration.apiKey+":"+this.configuration.apiSecret).toString("base64")}},this.fetcher);if(existing.ok)raw=await readMetadataJson(existing) as Record<string,unknown>;else await existing.body?.cancel();}catch(error){if(signal?.aborted)throw error;}
  if(!raw){
  const parameters={overwrite:"false",public_id:publicId,timestamp};
  const signature=createHash("sha1").update(Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+"="+value).join("&")+this.configuration.apiSecret).digest("hex");
  const body=new FormData();for(const [key,value]of Object.entries(parameters))body.set(key,value);body.set("api_key",this.configuration.apiKey);body.set("signature",signature);body.set("file",new Blob([new Uint8Array(bytes)],{type:source.mimeType}),source.sha256+"."+extension);
  const response=await fetchAudioHeaders(`https://api.cloudinary.com/v1_1/${this.configuration.cloudName}/video/upload`,{signal,headerTimeoutMs:45000,redirect:"error",method:"POST",body},this.fetcher);
  raw=await readMetadataJson(response) as Record<string,unknown>;
  if(!response.ok)throw new AudioPromotionError(response.status===420||response.status===429?"quota":"provider","The existing CDN account could not prepare this audio");
  }
  if(raw.public_id!==publicId||Number(raw.bytes)!==bytes.length||typeof raw.secure_url!=="string")throw new AudioPromotionError("integrity","CDN upload returned different audio identity or bytes");
  const format=String(raw.format||""),version=Number(raw.version),url=new URL(raw.secure_url);if(url.protocol!=="https:"||url.hostname!=="res.cloudinary.com"||!Number.isSafeInteger(version)||version<=0||!["mp3","mp4","m4a","aac","flac","ogg","opus","wav","webm"].includes(format)||url.pathname!==`/${this.configuration.cloudName}/video/upload/v${version}/${publicId}.${format}`||url.search||url.hash)throw new AudioPromotionError("integrity","CDN delivery address is not the configured immutable original asset");
  const delivered=await fetchAudioHeaders(url.toString(),{signal,headerTimeoutMs:25000,redirect:"error",headers:{"Accept-Encoding":"identity"}},this.fetcher);
  const verified=await completeAudio(delivered,source.sizeBytes,signal);if(digest(verified)!==source.sha256)throw new AudioPromotionError("integrity","CDN full-file checksum differs from the verified source");
  const assetId=cdnAssetId(recording.recordingId,source.sha256);
  const verifiedAt=new Date().toISOString();return{...source,assetId,candidate:{...source.candidate,candidateId:assetId},locator:{kind:"https",url:url.toString()},mimeType:normalizedAudioMime(delivered.headers.get("Content-Type")||source.mimeType),verifiedAt,deliveryEvidence:{method:"immutable-cdn-sha256",provider:"cloudinary",sourceAssetId:source.assetId,verifiedSha256:source.sha256,verifiedAt}};
 }
}

/** Coalesces equivalent work before transfer and leaves source fallback intact.
 * Deterministic CDN IDs and immutable public IDs are safe across app instances. */
export class AudioPromotions {
 private running=new Map<string,Promise<StoredAudioAsset>>();
 private failures=new Map<string,{until:number;reason:string}>();
 constructor(private readonly transport:AudioTransport,private readonly ingestor:RecordingIngestor,private readonly publisher?:AudioPublisher){}
 get configured(){return Boolean(this.publisher);}
 needsPreparation(asset:StoredAudioAsset){const failure=this.failures.get(asset.recordingId);return this.configured&&asset.locator.kind==="telegram-worker"&&asset.ownerAccountId===null&&(!failure||failure.until<=Date.now());}
 failureReason(recordingId:string){const failure=this.failures.get(recordingId);return failure&&failure.until>Date.now()?failure.reason:undefined;}
 prepare(recording:CanonicalRecording,source:StoredAudioAsset,signal?:AbortSignal):Promise<StoredAudioAsset>{
  if(!this.publisher||source.locator.kind==="https")return Promise.resolve(source);
  const key=recording.recordingId+":"+(source.sha256||JSON.stringify(source.locator)),existing=this.running.get(key);if(existing)return existing;
  if(this.running.size>=2){this.failures.set(recording.recordingId,{until:Date.now()+10000,reason:"busy"});return Promise.reject(new AudioPromotionError("busy","Audio preparation is at its transfer limit"));}
  const work=this.execute(recording,source,signal).catch(error=>{if(this.failures.size>=1000)this.failures.delete(this.failures.keys().next().value!);this.failures.set(recording.recordingId,{until:Date.now()+5*60000,reason:error instanceof AudioPromotionError?error.reason:"provider"});throw error;}).finally(()=>this.running.delete(key));
  this.running.set(key,work);return work;
 }
 private async execute(recording:CanonicalRecording,source:StoredAudioAsset,signal?:AbortSignal){
  const controllerSignal=signal??AbortSignal.timeout(100000);
  if(source.ownerAccountId!==null||source.recordingId!==recording.recordingId||!assessAudioCandidate(recording,source.candidate).acceptable)throw new AudioPromotionError("integrity","The source is not this full catalog recording");
  const bytes=await completeAudio(await this.transport.open(source,null,controllerSignal),source.sizeBytes,controllerSignal),sha256=digest(bytes);
  if(source.sha256&&source.sha256!==sha256)throw new AudioPromotionError("integrity","The worker file checksum changed");
  const checked={...source,sha256};await this.ingestor.persistAudio(recording,checked);
  const published=await this.publisher!.publish(recording,checked,bytes,controllerSignal);await this.ingestor.persistAudio(recording,published);this.failures.delete(recording.recordingId);return published;
 }
}
