import type { ResolveRecordingInput, ResolveRecordingResult, RecordingRepository } from "./contracts";
import type { RecordingResolver } from "./resolver";
import { RecordingIdentityConflict, type RecordingIngestor } from "./ingestion";
import type { AudioResolutionJobs } from "./jobs";
import type { PlaybackTargets } from "./targets";

export class ProductionRecordingResolver {
  constructor(private readonly repository: RecordingRepository,private readonly ingestor: RecordingIngestor,private readonly existing: RecordingResolver,private readonly jobs: AudioResolutionJobs,private readonly targets?:PlaybackTargets) {}
  async resolve(input: ResolveRecordingInput,accountId: string,signal?: AbortSignal): Promise<ResolveRecordingResult> {
    try {
      let existing = await this.existing.resolve(input,accountId,signal);
      if(existing.status==="review"&&(existing.reason==="asset-mismatch"||existing.reason==="catalog-mismatch")&&existing.recordingId){
        const recording=await this.repository.findById(existing.recordingId);
        if(recording){const enriched=await this.ingestor.hydrateVerifiedAliases(recording,signal);if(enriched!==recording)existing=await this.existing.resolve(input,accountId,signal);}
      }
      if(existing.status==="resolved"&&await this.jobs.needsPreparation(existing,accountId))return this.jobs.enqueue(existing.recording,accountId,"preparing-audio");
      // A stale/rejected stored source is recoverable by finding another exact
      // file. Catalogue conflicts and genuinely ambiguous valid files still need
      // the listener to choose their intended recording.
      if (existing.status === "resolved" || (existing.status === "review" && existing.reason !== "asset-mismatch")) {const result=this.jobs.decoratePreparation(existing);return this.targets?this.targets.decorate(result,accountId):result;}
      let recording = await this.repository.findByReference(input.reference);
      if (!recording) recording = await this.ingestor.ensureRecording(input.reference,input.expected,signal);
      return this.jobs.enqueue(recording,accountId);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof RecordingIdentityConflict) return { status: "review",reason:error.reason,candidates: error.candidates.map((recording) => ({ title: recording.metadata.title,artists: recording.metadata.artists,durationMs: recording.metadata.durationMs ?? null,reference:recording.references?.find(ref=>ref.provider==="deezer"||ref.provider==="spotify"),reasons:error.rejections })) };
      return { status: "unavailable",reason: "provider-unavailable",retryable: true };
    }
  }
}
