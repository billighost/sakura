import { createHash } from "node:crypto";
import { fetchAudioHeaders } from "../core/streaming";
import { assessAudioCandidate,verifiedRecordingAliases } from "../core/matching";
import { referenceKey,normalizedRecording } from "../core/identity";
import type { CanonicalRecording, ProviderReference, RecordingMetadata } from "../core/types";
import type { StoredAudioAsset, ReviewCandidate, CatalogProvider } from "./contracts";
import { parseRecordingMetadata, supportedAudioMime } from "./input";
import { readMetadataJson } from "./providers";
import { CatalogMetadataAliases } from "./metadata-aliases";

export type AudioDiscoveryResult = { status: "ready"; asset: StoredAudioAsset;verifiedMetadata?:RecordingMetadata } | { status: "review"; candidates: readonly ReviewCandidate[] } | { status: "unavailable"; reason: string; retryable: boolean };
function row(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export interface AudioSourceDiscovery { discover(recording: CanonicalRecording, signal?: AbortSignal): Promise<AudioDiscoveryResult> }

/** Source discovery creates/locates a bot-chat audio message, never transfers its full file. */
export class WorkerAudioDiscovery implements AudioSourceDiscovery {
  private compatibility = false;
  private primaryScopeOnlyUntil = 0;
  private readonly metadataAliases:CatalogMetadataAliases;
  constructor(private readonly configuration: { url: string; secret: string; primaryBot: string; fallbackBots?: readonly string[] } | null, private readonly fetcher: typeof fetch = fetch, providers: readonly CatalogProvider[] = []) {this.metadataAliases=new CatalogMetadataAliases(providers);}
  private async post(path: string, body: unknown, signal?: AbortSignal) {
    if (!this.configuration) throw new Error("Audio worker is not configured");
    const base = new URL(this.configuration.url);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid audio worker configuration");
    const response = await fetchAudioHeaders(new URL(path, base).toString(), { method: "POST", signal, headerTimeoutMs: 48000, redirect: "error",
      headers: { Authorization: `Bearer ${this.configuration.secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, this.fetcher);
    // Old workers and load balancers return plain-text 404/503 bodies. Parsing
    // those as JSON used to prevent protocol fallback entirely.
    if (!response.ok) {
      // Keep structured capability errors internally, while HTML/plain-text
      // infrastructure errors never prevent protocol or primary-bot fallback.
      if(response.headers.get("Content-Type")?.includes("application/json")){
        try{return {status:response.status,payload:row(await readMetadataJson(response))};}catch{return {status:response.status,payload:{}};}
      }
      await response.body?.cancel();return { status: response.status, payload: {} };
    }
    const payload = row(await readMetadataJson(response));
    return { status: response.status, payload };
  }
  private sourceReferences(recording: CanonicalRecording) {
    const references = new Map((recording.references ?? []).map(ref => [referenceKey(ref), ref]));
    verifiedRecordingAliases(recording).forEach(alias=>alias.references.forEach(ref=>references.set(referenceKey(ref),ref)));
    return [...references.values()].filter(ref => ref.provider === "deezer" || ref.provider === "spotify").slice(0, 6);
  }
  private matchingReferences(recording:CanonicalRecording){
    const references=new Map((recording.references??[]).map(ref=>[referenceKey(ref),ref]));
    verifiedRecordingAliases(recording).forEach(alias=>alias.references.forEach(ref=>references.set(referenceKey(ref),ref)));
    return [...references.values()];
  }
  private recoveryAliases(recording:CanonicalRecording,reference:ProviderReference){
    const original=normalizedRecording(recording.metadata);
    const spellingDifference=(metadata:RecordingMetadata)=>{
      const alternative=normalizedRecording(metadata);
      return (JSON.stringify(alternative.artists)!==JSON.stringify(original.artists)?2:0)+(alternative.title!==original.title?1:0);
    };
    // Same-artist localized titles can repeat the rejected spelling. Try the
    // independently verified artist/title changes before those slower repeats.
    return verifiedRecordingAliases(recording).filter(alias=>{
      const alternative=normalizedRecording(alias.metadata);
      return alternative.title!==original.title||JSON.stringify(alternative.artists)!==JSON.stringify(original.artists)
        ||alias.references.some(ref=>(ref.provider==="deezer"||ref.provider==="spotify")&&referenceKey(ref)!==referenceKey(reference));
    }).sort((a,b)=>spellingDifference(b.metadata)-spellingDifference(a.metadata)).slice(0,6);
  }
  async discover(recording: CanonicalRecording, signal?: AbortSignal): Promise<AudioDiscoveryResult> {
    if (!this.configuration) return { status: "unavailable", reason: "audio-worker-not-configured", retryable: false };
    signal?.throwIfAborted();
    const references = this.sourceReferences(recording), reference = references[0];
    if (!reference) return { status: "unavailable", reason: "recording-has-no-source-reference", retryable: false };
    if (!this.compatibility) {
      const scopes = [...new Set([this.configuration.primaryBot, ...(this.primaryScopeOnlyUntil > Date.now() ? [] : this.configuration.fallbackBots ?? [])])];
      const request = { reference, references:this.matchingReferences(recording), metadata: recording.metadata, deadlineMs: 35000, botScopes: scopes };
      let response = await this.post("/v2/resolve", request, signal);
      if(scopes.length>1&&[400,422,500].includes(response.status)){
        // Rolling deployments can expose a v2 worker whose allowed chats differ
        // from the app configuration. One unknown optional scope must never
        // disable the working primary source for every recording.
        const unsupportedScope = /unknown.*(?:chat\s+)?scope|unsupported.*(?:bot|chat|scope)/i.test(String(response.payload.error??response.payload.reason??""));
        if(unsupportedScope)this.primaryScopeOnlyUntil=Date.now()+5*60000;
        response=await this.post("/v2/resolve",{...request,botScopes:[this.configuration.primaryBot]},signal);
      }
      if (response.status === 404) this.compatibility = true;
      else {
        if (response.status === 429 || response.status === 503) return { status: "unavailable", reason: "audio-worker-busy", retryable: true };
        const initial=response.payload.status==="ready"?this.verifiedAsset(recording,row(response.payload.audio),"v2"):null;
        if(initial?.status==="ready")return initial;
        if(response.payload.status==="review"||initial?.status==="review"||response.payload.status==="unavailable"){
          // Persisted exact catalogue proof is already usable. Re-fetching it
          // here could spend the remaining job deadline on unrelated catalogue
          // or artist services before the known native spelling is attempted.
          const originalArtists=JSON.stringify(normalizedRecording(recording.metadata).artists);
          const cachedNativeProof=this.recoveryAliases(recording,reference).some(alias=>JSON.stringify(normalizedRecording(alias.metadata).artists)!==originalArtists);
          const enriched=cachedNativeProof?recording:await this.metadataAliases.hydrate(recording,signal);
          if(enriched!==recording||verifiedRecordingAliases(enriched).length){
            const original=normalizedRecording(recording.metadata);
            const deadline=Date.now()+30000,attempts=this.recoveryAliases(enriched,reference);
            for(const alias of attempts){
              signal?.throwIfAborted();if(Date.now()>=deadline)break;
              const alternative=normalizedRecording(alias.metadata),changedSpelling=alternative.title!==original.title||JSON.stringify(alternative.artists)!==JSON.stringify(original.artists);
              const verifiedReference=changedSpelling?reference:alias.references.find(ref=>(ref.provider==="deezer"||ref.provider==="spotify")&&referenceKey(ref)!==referenceKey(reference))??reference;
              // Older v2 workers reject native aliases before returning the
              // message ID. Retry their exact original request using one whole
              // provider-verified spelling, then verify against the original.
              let recovered:Awaited<ReturnType<WorkerAudioDiscovery["post"]>>;
              const budget=Math.min(12000,deadline-Date.now());
              if(budget<1000)break;
              const attemptSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(budget+1000)]):AbortSignal.timeout(budget+1000);
              try{recovered=await this.post("/v2/resolve",{...request,reference:verifiedReference,references:this.matchingReferences(enriched),metadata:alias.metadata,botScopes:this.primaryScopeOnlyUntil>Date.now()?[this.configuration.primaryBot]:scopes,deadlineMs:budget},attemptSignal);}catch{signal?.throwIfAborted();continue;}
              if(recovered.payload.status!=="ready")continue;
              const verified=this.verifiedAsset(enriched,row(recovered.payload.audio),"v2");
              if(verified.status==="ready")return {...verified,verifiedMetadata:enriched.metadata};
            }
            recording=enriched;
          }
        }
        if (response.payload.status === "review") return { status: "review", candidates: Array.isArray(response.payload.candidates) ? response.payload.candidates as ReviewCandidate[] : [] };
        if(initial)return initial;
        if (response.payload.status !== "ready") return { status: "unavailable", reason: String(response.payload.reason ?? "audio-source-unavailable"), retryable: true };
        return this.verifiedAsset(recording, row(response.payload.audio), "v2");
      }
    }
    // Current deployed worker receives the exact selected catalogue URL. We validate
    // its returned tags and /audio-info before accepting any audio; no fuzzy title lookup.
    recording=await this.metadataAliases.hydrate(recording,signal);
    const legacyReferences=this.sourceReferences(recording),candidates: ReviewCandidate[] = [], deadline = Date.now() + 45000;
    let reason = "audio-source-unavailable";
    for (let index = 0; index < legacyReferences.length; index++) {
      signal?.throwIfAborted();
      const ref = legacyReferences[index], remaining = deadline - Date.now();
      if (remaining < 1000) break;
      const budget = Math.min(30000, Math.max(8000, Math.floor(remaining / (legacyReferences.length - index))));
      const attemptSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(budget)]) : AbortSignal.timeout(budget);
      try {
        const url = ref.provider === "deezer" ? `https://www.deezer.com/track/${ref.id}` : `https://open.spotify.com/track/${ref.id}`;
        const selected = await this.post("/search-and-select", { query: url, references:this.matchingReferences(recording), expectedMetadata:recording.metadata, expectedTitle: recording.metadata.title, expectedArtist: recording.metadata.artists[0],
          targetDuration: recording.metadata.durationMs ? Math.round(recording.metadata.durationMs / 1000) : undefined, searchTimeoutMs: Math.min(15000, Math.floor(budget * .4)), selectTimeoutMs: Math.min(25000, Math.floor(budget * .6)), botUsername: this.configuration.primaryBot }, attemptSignal);
        if (selected.status !== 200 || selected.payload.error) continue;
        const messageId = String(selected.payload.messageId ?? "");
        if (!/^[1-9]\d{0,14}$/.test(messageId)) { reason = "audio-source-invalid-response"; continue; }
        const info = await this.post("/audio-info", { messageId }, attemptSignal);
        if (info.status !== 200) { reason = "audio-source-metadata-unavailable"; continue; }
        const verified = this.verifiedAsset(recording, { ...info.payload, messageId, chatScope: this.configuration.primaryBot }, "v1");
        if (verified.status === "ready") return {...verified,...(verifiedRecordingAliases(recording).length?{verifiedMetadata:recording.metadata}:{})};
        if (verified.status === "review") candidates.push(...verified.candidates);
        else reason = verified.reason;
      } catch { signal?.throwIfAborted(); reason = "audio-source-unavailable"; }
    }
    return candidates.length ? { status: "review", candidates } : { status: "unavailable", reason, retryable: true };
  }
  private verifiedAsset(recording: CanonicalRecording, raw: Record<string, unknown>, protocol: "v1" | "v2"): AudioDiscoveryResult {
    let metadata: RecordingMetadata;
    try {
      metadata = parseRecordingMetadata(raw.metadata ?? { title: raw.title, artists: [raw.artist],artistsComplete:false,durationMs: Math.round(Number(raw.duration) * 1000) });
      if(metadata.artistsComplete===undefined)metadata={...metadata,artistsComplete:false};
    }
    catch { return { status: "unavailable", reason: "audio-source-invalid-metadata", retryable: false }; }
    const messageId = String(raw.messageId ?? "");
    const chatScope = String(raw.chatScope ?? "");
    const mimeType = String(raw.mimeType ?? "");
    const sizeBytes = Number(raw.size ?? raw.sizeBytes);
    const documentId = protocol === "v2" && /^-?\d{1,25}$/.test(String(raw.fileId ?? "")) ? String(raw.fileId) : undefined;
    const allowedScopes = [this.configuration!.primaryBot, ...(this.configuration!.fallbackBots ?? [])].map(scope => scope.toLowerCase());
    if (!/^[1-9]\d{0,14}$/.test(messageId) || !/^[a-zA-Z0-9_]{3,64}$/.test(chatScope) || !allowedScopes.includes(chatScope.toLowerCase()) || !supportedAudioMime(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 4096 || sizeBytes > 120 * 1024 * 1024) return { status: "unavailable", reason: "audio-source-invalid-response", retryable: false };
    const sourceReference = { provider: "telegram" as const, id: messageId, scope: chatScope.toLowerCase() };
    const assessment = assessAudioCandidate(recording, { candidateId: messageId, metadata, audioKind: "full", references: [sourceReference] });
    if (!assessment.acceptable) return { status: "review", candidates: [{ title: metadata.title, artists: metadata.artists, durationMs: metadata.durationMs ?? null, reasons: assessment.reasons }] };
    // Rediscovering one immutable scoped Telegram message produces the same
    // asset, rather than a second equally-supported file and an ambiguity error.
    const hash = createHash("sha256").update(JSON.stringify([recording.recordingId, sourceReference, documentId ?? null, sizeBytes, mimeType])).digest("hex").slice(0, 32).split("");
    hash[12] = "5"; hash[16] = "8"; const value = hash.join("");
    const assetId = `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
    return { status: "ready",...(verifiedRecordingAliases(recording).length?{verifiedMetadata:recording.metadata}:{}), asset: { assetId,recordingId: recording.recordingId,candidate: { candidateId: assetId,metadata,references: [sourceReference],audioKind: "full" },
      locator: { kind: "telegram-worker",messageId,chatScope: chatScope.toLowerCase(),protocol,...(documentId?{documentId}:{}) },state: "ready",verifiedAt: new Date().toISOString(),mimeType,sizeBytes,ownerAccountId: null } };
  }
}
