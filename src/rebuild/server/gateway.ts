import { assessAudioCandidate } from "../core/matching";
import { fetchAudioHeaders, parseByteRange } from "../core/streaming";
import type { RecordingRepository, StoredAudioAsset } from "./contracts";
import { readMetadataJson } from "./providers";
import { isUuid, parseRecordingMetadata, normalizedAudioMime, supportedAudioMime } from "./input";
import { createHash,createHmac,timingSafeEqual } from "node:crypto";

const mime = normalizedAudioMime;
function safeUrl(raw: string, allowedOrigins: ReadonlySet<string>): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || !allowedOrigins.has(url.origin)) throw new Error("Audio source origin is not configured");
  return url.toString();
}
function jsonError(status: number, code: string): Response {
  return Response.json({ status: "unavailable", reason: code }, { status, headers: { "Cache-Control": "private, no-store" } });
}
async function waitForSource<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return work;signal.throwIfAborted();let abort:()=>void=()=>{};
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason??new DOMException("Canceled","AbortError"));signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();})]);}
 finally{signal.removeEventListener("abort",abort);}
}

export interface AudioTransport {
  /** Only a repository-resolved asset may reach a transport. No client URL input. */
  open(asset: StoredAudioAsset, range: string | null, signal?: AbortSignal): Promise<Response>;
}
export interface SourceTransportOptions {
  allowedCdnOrigins: readonly string[];
  worker?: { url: string; secret: string; chatScope: string };
  headerTimeoutMs?: number;
}

function workerDocumentTag(asset:StoredAudioAsset):string|undefined{
 return asset.locator.kind==="telegram-worker"&&asset.locator.protocol==="v2"&&asset.locator.documentId?
  `"${createHash("sha256").update(JSON.stringify([asset.locator.chatScope,asset.locator.messageId,asset.locator.documentId,asset.sizeBytes,asset.mimeType])).digest("hex")}"`:undefined;
}

/** Opens ready assets; no search/select/import/full-download worker operations exist here. */
export class SourceAudioTransport implements AudioTransport {
  private readonly origins: ReadonlySet<string>;
  private signed = new Map<string,{url:string;expires:number}>();
  private signing = new Map<string,Promise<string|undefined>>();
  private probing = new Map<string,Promise<void>>();
  private inspected = new Map<string,number>();
  constructor(private readonly options: SourceTransportOptions, private readonly fetcher: typeof fetch = fetch) {
    this.origins = new Set(options.allowedCdnOrigins.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("CDN origin must be HTTPS");
      return url.origin;
    }));
  }
  directPlaybackUrl(asset: StoredAudioAsset): string | undefined {
    if (asset.locator.kind !== "https") return undefined;
    try { return safeUrl(asset.locator.url, this.origins); } catch { return undefined; }
  }
  async signedPlaybackUrl(asset: StoredAudioAsset): Promise<string | undefined> {
    const running=this.signing.get(asset.assetId);if(running)return running;
    const work=this.mintSignedPlaybackUrl(asset).finally(()=>this.signing.delete(asset.assetId));this.signing.set(asset.assetId,work);return work;
  }
  private async mintSignedPlaybackUrl(asset:StoredAudioAsset):Promise<string|undefined>{
    if(asset.locator.kind==="https")return this.directPlaybackUrl(asset);
    const worker=this.options.worker;if(!worker)return undefined;
    const cached=this.signed.get(asset.assetId);if(cached&&cached.expires>Date.now()+60000)return cached.url;
    const scoped=asset.locator.protocol==="v2";
    const documentTag=workerDocumentTag(asset);
    if(scoped&&!documentTag)return undefined;
    if(!scoped&&worker.chatScope.toLowerCase()!==asset.locator.chatScope.toLowerCase())return undefined;
    try{
      const response=await fetchAudioHeaders(new URL(scoped?"/v2/sign-audio":"/sign-audio",worker.url).toString(),{method:"POST",headerTimeoutMs:5000,redirect:"error",
        headers:{Authorization:`Bearer ${worker.secret}`,"Content-Type":"application/json"},body:JSON.stringify({messageId:asset.locator.messageId,chatScope:asset.locator.chatScope,ttlSeconds:1800,...(documentTag?{documentTag}:{})})},this.fetcher);
      if(!response.ok){await response.body?.cancel();return undefined;}
      const raw=await readMetadataJson(response) as {path?:string;expiresAt?:number};
      const prefix=scoped?`/v2/audio/${asset.locator.chatScope}/${asset.locator.messageId}?`:`/audio/${asset.locator.messageId}?`;
      if(typeof raw.path!=="string"||!raw.path.startsWith(prefix))return undefined;
      const url=new URL(raw.path,worker.url);if(url.protocol!=="https:"||url.origin!==new URL(worker.url).origin)return undefined;
      const expires=Number(raw.expiresAt)*1000;if(!Number.isFinite(expires)||expires<Date.now()+60000)return undefined;
      if(documentTag){
        const signature=url.searchParams.get("sig")??"",expiry=Number(raw.expiresAt);
        if(!Number.isSafeInteger(expiry)||url.searchParams.get("exp")!==String(expiry)||url.searchParams.getAll("documentTag").length!==1||url.searchParams.get("documentTag")!==documentTag||!/^[a-f0-9]{64}$/.test(signature))return undefined;
        const expected=createHmac("sha256",worker.secret).update(JSON.stringify([asset.locator.chatScope.toLowerCase(),asset.locator.messageId,expiry,documentTag])).digest();
        if(!timingSafeEqual(Buffer.from(signature,"hex"),expected))return undefined;
      }
      if(this.signed.size>=1000)this.signed.delete(this.signed.keys().next().value!);
      this.signed.set(asset.assetId,{url:url.toString(),expires});return url.toString();
    }catch{return undefined;}
  }
  async open(asset: StoredAudioAsset, range: string | null, signal?: AbortSignal): Promise<Response> {
    if (asset.locator.kind === "https") {
      let url = safeUrl(asset.locator.url, this.origins);
      for (let redirect = 0; redirect <= 3; redirect++) {
        const response = await fetchAudioHeaders(url, { signal, headerTimeoutMs: this.options.headerTimeoutMs ?? 8000, redirect: "manual", headers: { "Accept-Encoding": "identity", ...(range ? { Range: range } : {}) } }, this.fetcher);
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("Location");
        await response.body?.cancel();
        if (!location || redirect === 3) throw new Error("Audio source redirect failed");
        url = safeUrl(new URL(location, url).toString(), this.origins);
      }
      throw new Error("Audio source redirect failed");
    }
    const worker = this.options.worker;
    // Current worker's /audio-info and /audio are scoped to its primary bot.
    // Refuse fallback-bot locators until that API supports explicit chat scope.
    const scoped=asset.locator.protocol==="v2";
    if (!worker || (!scoped&&worker.chatScope.toLowerCase() !== asset.locator.chatScope.toLowerCase())) throw new Error("Worker chat scope is not supported");
    if (!/^[1-9]\d{0,14}$/.test(asset.locator.messageId)) throw new Error("Worker message ID is invalid");
    const base = new URL(worker.url);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Worker origin must be HTTPS");
    const headers = { Authorization: `Bearer ${worker.secret}` };
    const locator = asset.locator;
    // Inspect the actual existing audio's tags before delivery, without downloading it.
    const probeKey=scoped&&asset.locator.documentId?JSON.stringify([asset.locator,asset.sizeBytes,asset.mimeType,asset.candidate.metadata]):null;
    const probe=async(probeSignal?:AbortSignal)=>{
    const infoResponse = await fetchAudioHeaders(new URL(scoped?"/v2/audio-info":"/audio-info", base).toString(), {
      method: "POST", signal:probeSignal, headerTimeoutMs: this.options.headerTimeoutMs ?? 8000, redirect: "error",
      headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ messageId: locator.messageId,chatScope:locator.chatScope }),
    }, this.fetcher);
    if (!infoResponse.ok) { await infoResponse.body?.cancel(); throw new Error("Worker audio metadata is unavailable"); }
    const raw = await readMetadataJson(infoResponse);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Worker audio metadata is malformed");
    const info = raw as Record<string, unknown>;
    if(asset.locator.kind==="telegram-worker"&&asset.locator.documentId&&String(info.fileId)!==asset.locator.documentId)throw new Error("Worker document has changed since validation");
    if (Number(info.size) !== asset.sizeBytes || typeof info.mimeType !== "string" || mime(info.mimeType) !== mime(asset.mimeType)) throw new Error("Worker audio has changed since validation");
    const metadata = parseRecordingMetadata(info.metadata??{ title: info.title, artists: [info.artist], artistsComplete:false, durationMs: Math.round(Number(info.duration) * 1000) });
    const assessment = assessAudioCandidate(asset.candidate, { candidateId: "worker-probe", metadata, audioKind: "full" });
    if (!assessment.acceptable) throw new Error("Worker audio identity does not match the verified recording");
    };
    if(probeKey){
      if((this.inspected.get(probeKey)??0)<=Date.now()){
        let work=this.probing.get(probeKey);
        if(!work){work=probe(AbortSignal.timeout(this.options.headerTimeoutMs??8000)).then(()=>{if(this.inspected.size>=1000)this.inspected.delete(this.inspected.keys().next().value!);this.inspected.set(probeKey,Date.now()+10000);}).finally(()=>this.probing.delete(probeKey));this.probing.set(probeKey,work);}
        await waitForSource(work,signal);
      }
    }else await probe(signal);
    signal?.throwIfAborted();
    const documentTag=workerDocumentTag(asset);
    return fetchAudioHeaders(new URL(scoped?`/v2/audio/${asset.locator.chatScope}/${asset.locator.messageId}`:`/audio/${asset.locator.messageId}`, base).toString(), {
      signal, headerTimeoutMs: this.options.headerTimeoutMs ?? 8000, redirect: "error", headers: { ...headers, "Accept-Encoding": "identity", ...(documentTag?{"If-Match":documentTag}:{}), ...(range ? { Range: range,...(documentTag?{"If-Range":documentTag}:{}) } : {}) },
    }, this.fetcher);
  }
}

/** Detect truncated/oversized audio without buffering the file before playback. */
function checkedBody(body: ReadableStream<Uint8Array>, expectedBytes: number,signal?:AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;
  const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};
  const cleanup=()=>signal?.removeEventListener("abort",abort);
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  return new ReadableStream({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        if (done) {
          cleanup();
          reader.releaseLock();
          if (received !== expectedBytes) controller.error(new Error("Audio stream ended before its verified size"));
          else controller.close();
          return;
        }
        received += value.byteLength;
        if (received > expectedBytes) { cleanup();await reader.cancel(); reader.releaseLock(); controller.error(new Error("Audio stream exceeds its verified size")); }
        else controller.enqueue(value);
      } catch (error) { cleanup();void reader.cancel(error).catch(()=>{});reader.releaseLock();controller.error(error); }
    },
    async cancel(reason) { cleanup();try{await reader.cancel(reason);}finally{reader.releaseLock();} },
  });
}

function validAudioResponse(response:Response,asset:StoredAudioAsset,range:ReturnType<typeof parseByteRange>):boolean{
 if(!response.body||mime(response.headers.get("Content-Type")??"")!==mime(asset.mimeType))return false;
 const reportedLength=response.headers.get("Content-Length");
 if(range.status==="range"){
  const contentRange=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")??"");
  return response.status===206&&Boolean(contentRange&&Number(contentRange[1])===range.start&&Number(contentRange[2])===range.end&&Number(contentRange[3])===asset.sizeBytes)
   &&(reportedLength===null||Number(reportedLength)===range.end-range.start+1);
 }
 return response.status===200&&(reportedLength===null||Number(reportedLength)===asset.sizeBytes);
}

/** Auth is handled by the route; this gateway repeats asset ownership and identity checks. */
export class RecordingAudioGateway {
  constructor(private readonly repository: RecordingRepository, private readonly transport: AudioTransport) {}
  async serve(input: { recordingId: string; assetId: string; accountId: string; range?: string | null; ifRange?: string | null; method?: "GET" | "HEAD"; signal?: AbortSignal }): Promise<Response> {
    if (!isUuid(input.recordingId) || !isUuid(input.assetId) || !isUuid(input.accountId)) return jsonError(400, "invalid-recording-reference");
    if (!this.repository.initialized) return jsonError(503, "backend-not-initialized");
    input.signal?.throwIfAborted();
    const [recording, asset] = await Promise.all([
      this.repository.findById(input.recordingId), this.repository.findAudio(input.recordingId, input.assetId, input.accountId),
    ]);
    if (!recording || !asset || asset.recordingId !== input.recordingId || (asset.ownerAccountId !== null && asset.ownerAccountId !== input.accountId)) return jsonError(404, "audio-not-found");
    if (asset.state !== "ready" || asset.candidate.audioKind !== "full" || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || !supportedAudioMime(asset.mimeType)) return jsonError(409, "audio-not-ready");
    if (!asset.verifiedAt || !Number.isFinite(Date.parse(asset.verifiedAt)) || !assessAudioCandidate(recording, asset.candidate).acceptable) return jsonError(409, "audio-identity-review-required");
    const etag = `"sakura-${asset.assetId}-${asset.sizeBytes}-${asset.sha256 || "verified-tags"}"`;
    const modified = new Date(asset.verifiedAt).toUTCString();
    const rangeMatches = !input.ifRange || input.ifRange === etag || (input.ifRange === modified && Boolean(asset.sha256));
    const range = parseByteRange(input.method === "HEAD" || !rangeMatches ? null : input.range ?? null, asset.sizeBytes);
    const baseHeaders = new Headers({ "Content-Type": mime(asset.mimeType), "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", ETag: etag, "Last-Modified": modified });
    if (range.status === "unsatisfiable") {
      baseHeaders.set("Content-Range", `bytes */${asset.sizeBytes}`);
      return new Response(null, { status: 416, headers: baseHeaders });
    }
    if (input.method === "HEAD") {
      baseHeaders.set("Content-Length", String(asset.sizeBytes));
      return new Response(null, { status: 200, headers: baseHeaders });
    }
    let upstream: Response;let deliveryAsset=asset;
    try {
      // This endpoint is the independent fallback for a published CDN file.
      // Its immutable proof may point only to the verified byte-identical source;
      // matching display metadata alone must never choose another recording/file.
      const proof=asset.deliveryEvidence;
      if(asset.locator.kind==="https"&&asset.ownerAccountId===null&&asset.sha256&&/^[a-f0-9]{64}$/.test(asset.sha256)
        &&proof?.method==="immutable-cdn-sha256"&&proof.provider==="cloudinary"&&isUuid(proof.sourceAssetId)&&proof.verifiedSha256===asset.sha256
        &&Number.isFinite(Date.parse(proof.verifiedAt))){
        let original:StoredAudioAsset|null=null;try{original=await this.repository.findAudio(input.recordingId,proof.sourceAssetId,input.accountId);}catch(error){if(input.signal?.aborted)throw error;}
        if(original&&original.assetId===proof.sourceAssetId&&original.recordingId===asset.recordingId&&original.ownerAccountId===null&&original.locator.kind==="telegram-worker"
          &&original.sha256===asset.sha256&&original.sizeBytes===asset.sizeBytes&&mime(original.mimeType)===mime(asset.mimeType)
          &&original.state==="ready"&&original.candidate.audioKind==="full"&&original.verifiedAt&&Number.isFinite(Date.parse(original.verifiedAt))
          &&assessAudioCandidate(recording,original.candidate).acceptable)deliveryAsset=original;
      }
      const sourceRange=range.status === "range" ? `bytes=${range.start}-${range.end}` : null;
      const open=async(candidate:StoredAudioAsset)=>{
        input.signal?.throwIfAborted();
        const response=await this.transport.open(candidate,sourceRange,input.signal);
        if(input.signal?.aborted){await response.body?.cancel(input.signal.reason).catch(()=>{});input.signal.throwIfAborted();}
        return response;
      };
      try{upstream=await open(deliveryAsset);}catch(error){if(deliveryAsset===asset||input.signal?.aborted)throw error;deliveryAsset=asset;upstream=await open(asset);}
      // Worker restarts and document changes can return HTTP errors instead of
      // throwing. Reject their headers before returning any bytes, then retry
      // only the independently verified byte-identical CDN artifact.
      if(deliveryAsset!==asset&&!validAudioResponse(upstream,asset,range)){
        await upstream.body?.cancel().catch(()=>{});deliveryAsset=asset;upstream=await open(asset);
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return jsonError(502, "audio-source-unavailable");
    }
    baseHeaders.set("X-Sakura-Audio-Delivery",deliveryAsset===asset?"primary":"verified-source-fallback");
    const badUpstream = async () => { await upstream.body?.cancel().catch(()=>{}); return jsonError(502, "audio-source-invalid-response"); };
    if (!validAudioResponse(upstream,asset,range)) return badUpstream();
    if (range.status === "range") {
      const length = range.end - range.start + 1;
      baseHeaders.set("Content-Range", `bytes ${range.start}-${range.end}/${asset.sizeBytes}`);
      baseHeaders.set("Content-Length", String(length));
      return new Response(checkedBody(upstream.body!, length,input.signal), { status: 206, headers: baseHeaders });
    }
    // Deliberately streamed without a full-body buffer or Content-Length on 200.
    return new Response(checkedBody(upstream.body!, asset.sizeBytes,input.signal), { status: 200, headers: baseHeaders });
  }
}
