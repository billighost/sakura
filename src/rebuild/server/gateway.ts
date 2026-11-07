import { assessAudioCandidate } from "../core/matching";
import { fetchAudioHeaders, parseByteRange } from "../core/streaming";
import type { RecordingRepository, StoredAudioAsset } from "./contracts";
import { readMetadataJson } from "./providers";
import { isUuid, parseRecordingMetadata, normalizedAudioMime, supportedAudioMime } from "./input";

const mime = normalizedAudioMime;
function safeUrl(raw: string, allowedOrigins: ReadonlySet<string>): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || !allowedOrigins.has(url.origin)) throw new Error("Audio source origin is not configured");
  return url.toString();
}
function jsonError(status: number, code: string): Response {
  return Response.json({ status: "unavailable", reason: code }, { status, headers: { "Cache-Control": "private, no-store" } });
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

/** Opens ready assets; no search/select/import/full-download worker operations exist here. */
export class SourceAudioTransport implements AudioTransport {
  private readonly origins: ReadonlySet<string>;
  private signed = new Map<string,{url:string;expires:number}>();
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
    if(asset.locator.kind==="https")return this.directPlaybackUrl(asset);
    const worker=this.options.worker;if(!worker)return undefined;
    const cached=this.signed.get(asset.assetId);if(cached&&cached.expires>Date.now()+60000)return cached.url;
    const scoped=asset.locator.protocol==="v2";
    if(!scoped&&worker.chatScope.toLowerCase()!==asset.locator.chatScope.toLowerCase())return undefined;
    try{
      const response=await fetchAudioHeaders(new URL(scoped?"/v2/sign-audio":"/sign-audio",worker.url).toString(),{method:"POST",headerTimeoutMs:5000,redirect:"error",
        headers:{Authorization:`Bearer ${worker.secret}`,"Content-Type":"application/json"},body:JSON.stringify({messageId:asset.locator.messageId,chatScope:asset.locator.chatScope,ttlSeconds:1800})},this.fetcher);
      if(!response.ok){await response.body?.cancel();return undefined;}
      const raw=await readMetadataJson(response) as {path?:string;expiresAt?:number};
      const prefix=scoped?`/v2/audio/${asset.locator.chatScope}/${asset.locator.messageId}?`:`/audio/${asset.locator.messageId}?`;
      if(typeof raw.path!=="string"||!raw.path.startsWith(prefix))return undefined;
      const url=new URL(raw.path,worker.url);if(url.protocol!=="https:"||url.origin!==new URL(worker.url).origin)return undefined;
      const expires=Number(raw.expiresAt)*1000;if(!Number.isFinite(expires)||expires<Date.now()+60000)return undefined;
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
    // Inspect the actual existing audio's tags before delivery, without downloading it.
    const infoResponse = await fetchAudioHeaders(new URL(scoped?"/v2/audio-info":"/audio-info", base).toString(), {
      method: "POST", signal, headerTimeoutMs: this.options.headerTimeoutMs ?? 8000, redirect: "error",
      headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ messageId: asset.locator.messageId,chatScope:asset.locator.chatScope }),
    }, this.fetcher);
    if (!infoResponse.ok) { await infoResponse.body?.cancel(); throw new Error("Worker audio metadata is unavailable"); }
    const raw = await readMetadataJson(infoResponse);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Worker audio metadata is malformed");
    const info = raw as Record<string, unknown>;
    if (Number(info.size) !== asset.sizeBytes || typeof info.mimeType !== "string" || mime(info.mimeType) !== mime(asset.mimeType)) throw new Error("Worker audio has changed since validation");
    const metadata = parseRecordingMetadata(info.metadata??{ title: info.title, artists: [info.artist], durationMs: Math.round(Number(info.duration) * 1000) });
    const assessment = assessAudioCandidate(asset.candidate, { candidateId: "worker-probe", metadata, audioKind: "full" });
    if (!assessment.acceptable) throw new Error("Worker audio identity does not match the verified recording");
    return fetchAudioHeaders(new URL(scoped?`/v2/audio/${asset.locator.chatScope}/${asset.locator.messageId}`:`/audio/${asset.locator.messageId}`, base).toString(), {
      signal, headerTimeoutMs: this.options.headerTimeoutMs ?? 8000, redirect: "error", headers: { ...headers, "Accept-Encoding": "identity", ...(range ? { Range: range } : {}) },
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

/** Auth is handled by the route; this gateway repeats asset ownership and identity checks. */
export class RecordingAudioGateway {
  constructor(private readonly repository: RecordingRepository, private readonly transport: AudioTransport) {}
  async serve(input: { recordingId: string; assetId: string; accountId: string; range?: string | null; method?: "GET" | "HEAD"; signal?: AbortSignal }): Promise<Response> {
    if (!isUuid(input.recordingId) || !isUuid(input.assetId) || !isUuid(input.accountId)) return jsonError(400, "invalid-recording-reference");
    if (!this.repository.initialized) return jsonError(503, "backend-not-initialized");
    input.signal?.throwIfAborted();
    const [recording, asset] = await Promise.all([
      this.repository.findById(input.recordingId), this.repository.findAudio(input.recordingId, input.assetId, input.accountId),
    ]);
    if (!recording || !asset || asset.recordingId !== input.recordingId || (asset.ownerAccountId !== null && asset.ownerAccountId !== input.accountId)) return jsonError(404, "audio-not-found");
    if (asset.state !== "ready" || asset.candidate.audioKind !== "full" || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || !supportedAudioMime(asset.mimeType)) return jsonError(409, "audio-not-ready");
    if (!asset.verifiedAt || !Number.isFinite(Date.parse(asset.verifiedAt)) || !assessAudioCandidate(recording, asset.candidate).acceptable) return jsonError(409, "audio-identity-review-required");
    const range = parseByteRange(input.method === "HEAD" ? null : input.range ?? null, asset.sizeBytes);
    const baseHeaders = new Headers({ "Content-Type": mime(asset.mimeType), "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
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
      try{upstream=await this.transport.open(deliveryAsset,sourceRange,input.signal);}catch(error){if(deliveryAsset===asset||input.signal?.aborted)throw error;deliveryAsset=asset;upstream=await this.transport.open(asset,sourceRange,input.signal);}
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return jsonError(502, "audio-source-unavailable");
    }
    baseHeaders.set("X-Sakura-Audio-Delivery",deliveryAsset===asset?"primary":"verified-source-fallback");
    const badUpstream = async () => { await upstream.body?.cancel(); return jsonError(502, "audio-source-invalid-response"); };
    if (!upstream.body || mime(upstream.headers.get("Content-Type") ?? "") !== mime(asset.mimeType)) return badUpstream();
    if (range.status === "range") {
      const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get("Content-Range") ?? "");
      if (upstream.status !== 206 || !contentRange || Number(contentRange[1]) !== range.start || Number(contentRange[2]) !== range.end || Number(contentRange[3]) !== asset.sizeBytes) return badUpstream();
      const length = range.end - range.start + 1;
      const reportedLength = upstream.headers.get("Content-Length");
      if (reportedLength !== null && Number(reportedLength) !== length) return badUpstream();
      baseHeaders.set("Content-Range", `bytes ${range.start}-${range.end}/${asset.sizeBytes}`);
      baseHeaders.set("Content-Length", String(length));
      return new Response(checkedBody(upstream.body, length,input.signal), { status: 206, headers: baseHeaders });
    }
    const reportedLength = upstream.headers.get("Content-Length");
    if (upstream.status !== 200 || (reportedLength !== null && Number(reportedLength) !== asset.sizeBytes)) return badUpstream();
    // Deliberately streamed without a full-body buffer or Content-Length on 200.
    return new Response(checkedBody(upstream.body, asset.sizeBytes,input.signal), { status: 200, headers: baseHeaders });
  }
}
