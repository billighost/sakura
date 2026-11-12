import { assessAudioCandidate, selectAudioCandidate } from "../core/matching";
import { referenceKey } from "../core/identity";
import type { CanonicalRecording, RecordingMetadata, ProviderReference, RecordingRequest } from "../core/types";
import type { CatalogProvider, CatalogRecording, RecordingRepository, ResolveRecordingInput, ResolveRecordingResult, ReviewCandidate, StoredAudioAsset } from "./contracts";
import { supportedAudioMime } from "./input";
import { CatalogMetadataAliases,withVerifiedCatalogAliases } from "./metadata-aliases";
import { rememberResolvedAsset } from "./resolved-asset";

function reviewCandidate(metadata: RecordingMetadata, reasons: readonly string[], extras: { reference?: ProviderReference; assetId?: string } = {}): ReviewCandidate {
  return { title: metadata.title, artists: metadata.artists, durationMs: metadata.durationMs ?? null, reasons, ...extras };
}
function metadataAssessment(request: RecordingRequest, metadata: RecordingMetadata, references: readonly ProviderReference[] = []) {
  return assessAudioCandidate(request, { candidateId: "metadata", metadata, references, audioKind: "full" });
}
function assetAllowed(asset: StoredAudioAsset, recordingId: string, accountId: string): boolean {
  return asset.recordingId === recordingId && asset.state === "ready" && asset.candidate.audioKind === "full"
    && (asset.ownerAccountId === null || asset.ownerAccountId === accountId) && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0
    && !!asset.verifiedAt && Number.isFinite(Date.parse(asset.verifiedAt)) && supportedAudioMime(asset.mimeType);
}

/** This service resolves metadata and ready assets. It does not start bot searches or download bytes. */
export class RecordingResolver {
  private readonly metadataAliases:CatalogMetadataAliases;
  constructor(private readonly repository: RecordingRepository, private readonly providers: readonly CatalogProvider[], private readonly directPlaybackUrl?: (asset: StoredAudioAsset) => string | undefined) {this.metadataAliases=new CatalogMetadataAliases(providers);}

  async resolve(input: ResolveRecordingInput, accountId: string, signal?: AbortSignal): Promise<ResolveRecordingResult> {
    signal?.throwIfAborted();
    // A verified alias + ready asset needs no repeat catalogue fetch.
    let recording = await this.repository.findByReference(input.reference);
    let catalog: CatalogRecording | undefined;
    if (!recording) {
      const provider = this.providers.find((entry) => entry.provider === input.reference.provider);
      if (!provider) return { status: "unavailable", reason: "unsupported-provider", retryable: false };
      try {
        catalog = await provider.getExact(input.reference, signal) ?? undefined;
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: "unavailable", reason: "provider-unavailable", retryable: true };
      }
      if (!catalog) return { status: "unavailable", reason: "catalog-not-found", retryable: false };
      if (referenceKey(catalog.reference) !== referenceKey(input.reference)) return { status: "unavailable", reason: "provider-unavailable", retryable: true };
      if (input.expected) {
        let evidence = metadataAssessment(catalog,input.expected,[input.reference]);
        if(!evidence.acceptable&&evidence.reasons.every(reason=>reason==="title"||reason==="artist")){
          const enriched=await this.metadataAliases.hydrate({recordingId:referenceKey(input.reference),metadata:catalog.metadata,references:catalog.references},signal);
          catalog={...catalog,metadata:enriched.metadata};evidence=metadataAssessment(catalog,input.expected,[input.reference]);
        }
        if (!evidence.acceptable) return { status: "review", reason: "catalog-mismatch", candidates: [reviewCandidate(catalog.metadata, evidence.reasons, { reference: catalog.reference })] };
      }
      if (!this.repository.initialized) return { status: "unavailable", reason: "backend-not-initialized", catalog, retryable: false };
      const found = new Map<string, CanonicalRecording>();
      for (const ref of catalog.references) {
        const match = await this.repository.findByReference(ref);
        if (match) found.set(match.recordingId, match);
      }
      if (found.size > 1) return { status: "review", reason: "identity-conflict", candidates: [...found.values()].map((item) => reviewCandidate(item.metadata, ["identifier-conflict"])) };
      recording = [...found.values()][0] ?? null;
      if (!recording) return { status: "unavailable", reason: "recording-not-indexed", catalog, retryable: false };
      recording={...recording,metadata:withVerifiedCatalogAliases(recording,[catalog])};
      const verified = metadataAssessment(recording, catalog.metadata, catalog.references);
      if (!verified.acceptable) return { status: "review", reason: "catalog-mismatch", recordingId: recording.recordingId, candidates: [reviewCandidate(recording.metadata, verified.reasons)] };
    } else if (input.expected) {
      const expected = metadataAssessment(recording, input.expected,[input.reference]);
      if (!expected.acceptable) return { status: "review", reason: "catalog-mismatch", recordingId: recording.recordingId, candidates: [reviewCandidate(recording.metadata, expected.reasons)] };
    }
    signal?.throwIfAborted();
    const assets = (await this.repository.listAudio(recording.recordingId, accountId)).filter((asset) => assetAllowed(asset, recording.recordingId, accountId));
    if (!assets.length) return { status: "unavailable", reason: "no-ready-audio", recordingId: recording.recordingId, retryable: true };
    // Full-transfer integrity evidence outranks tag-only candidates. Equal hashes
    // establish byte equivalence, so duplicate source messages remain one choice.
    // Different checked files still pass through the normal ambiguity rules.
    const checked=assets.filter(asset=>asset.sha256&&/^[a-f0-9]{64}$/.test(asset.sha256)&&assessAudioCandidate(recording,asset.candidate).acceptable);
    const groups=new Map<string,StoredAudioAsset>();
    for(const asset of checked){const key=`${asset.sha256}:${asset.sizeBytes}`,previous=groups.get(key);if(!previous||(!this.directPlaybackUrl?.(previous)&&this.directPlaybackUrl?.(asset)))groups.set(key,asset);}
    const candidates=checked.length?[...groups.values()]:assets;
    const selection = selectAudioCandidate(recording, candidates.map((asset) => asset.candidate));
    if (selection.status === "unavailable") return { status: "review", reason: "asset-mismatch", recordingId: recording.recordingId,
      candidates: selection.assessments.map((item) => reviewCandidate(item.candidate.metadata, item.reasons, { assetId: item.candidate.candidateId })) };
    if (selection.status === "ambiguous") return { status: "review", reason: "ambiguous-audio", recordingId: recording.recordingId,
      candidates: selection.candidates.map((item) => reviewCandidate(item.metadata, ["equally-supported-candidates"], { assetId: item.candidateId })) };
    const selected = assets.find((asset) => asset.candidate.candidateId === selection.candidate.candidateId)!;
    const gatewayUrl=`/api/v2/recordings/${encodeURIComponent(recording.recordingId)}/audio?assetId=${encodeURIComponent(selected.assetId)}`;
    const playbackUrl=this.directPlaybackUrl?.(selected)??gatewayUrl;
    return rememberResolvedAsset({ status: "resolved", recording,
      playback: { kind: "stream", assetId: selected.assetId, url:playbackUrl,...(playbackUrl!==gatewayUrl?{fallbackUrl:gatewayUrl}:{}),
        mimeType: selected.mimeType, sizeBytes: selected.sizeBytes, durationMs: recording.metadata.durationMs ?? null,...(selected.sha256?{sha256:selected.sha256}:{}),...(selected.locator.kind==="https"?{delivery:"cdn" as const}:{}) } }, selected);
  }
}
