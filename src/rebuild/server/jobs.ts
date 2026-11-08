import { randomUUID } from "node:crypto";
import type { CanonicalRecording } from "../core/types";
import type { ResolveRecordingResult, RecordingRepository } from "./contracts";
import type { ReadonlySql } from "./repository";
import type { RecordingIngestor } from "./ingestion";
import type { AudioSourceDiscovery } from "./sources";
import type { RecordingResolver } from "./resolver";
import type { PlaybackTargets } from "./targets";
import type { AudioPromotions } from "./promotion";

interface JobRow { id: string; accountId: string; recordingId: string; state: string; result: ResolveRecordingResult | null; leaseUntil: Date | null; attempts: number }
const JOB_SELECT = `SELECT id,account_id AS "accountId",recording_id AS "recordingId",state,result,lease_until AS "leaseUntil",attempts FROM sakura_v2."AudioResolveJob"`;

/** DB-backed jobs survive navigation/reload; each source search is bounded and coalesced. */
export class AudioResolutionJobs {
  private running = new Map<string, Promise<void>>();
  constructor(private readonly query: ReadonlySql,private readonly repository: RecordingRepository,private readonly ingestor: RecordingIngestor,private readonly discovery: AudioSourceDiscovery,private readonly resolver: RecordingResolver,private readonly targets?:PlaybackTargets,private readonly promotions?:AudioPromotions) {}
  async needsPreparation(result:ResolveRecordingResult,accountId:string){if(result.status!=="resolved"||!this.promotions?.configured)return false;const asset=await this.repository.findAudio(result.recording.recordingId,result.playback.assetId,accountId);return Boolean(asset&&this.promotions.needsPreparation(asset));}
  decoratePreparation(result:ResolveRecordingResult):ResolveRecordingResult{if(result.status!=="resolved")return result;const reason=this.promotions?.failureReason(result.recording.recordingId,result.playback.assetId);if(reason==="integrity")return{status:"review",reason:"asset-mismatch",recordingId:result.recording.recordingId,candidates:[{title:result.recording.metadata.title,artists:result.recording.metadata.artists,durationMs:result.recording.metadata.durationMs??null,reasons:["full-file-integrity-review"]}]};return reason?{...result,playback:{...result.playback,delivery:"worker-fallback",preparationFailure:reason}}:result;}
  async enqueue(recording: CanonicalRecording,accountId: string,stage?:"finding-source"|"preparing-audio"): Promise<ResolveRecordingResult> {
    const id = randomUUID();
    const inserted = await this.query<{ id: string }>(`INSERT INTO sakura_v2."AudioResolveJob"(id,account_id,recording_id,state) VALUES($1::uuid,$2::uuid,$3::uuid,'queued') ON CONFLICT DO NOTHING RETURNING id`,[id,accountId,recording.recordingId]);
    const existing = inserted[0] ? inserted[0] : (await this.query<{ id: string }>(`SELECT id FROM sakura_v2."AudioResolveJob" WHERE account_id=$1::uuid AND recording_id=$2::uuid AND state IN ('queued','resolving') ORDER BY created_at DESC LIMIT 1`,[accountId,recording.recordingId]))[0];
    if (!existing) throw new Error("Audio resolution job could not be created");
    return this.pending(existing.id,recording,stage);
  }
  private pending(jobId: string,recording: CanonicalRecording,stage?:"finding-source"|"preparing-audio"): ResolveRecordingResult {
    return { status: "pending",jobId,recording,pollUrl: `/api/v2/recordings/jobs/${jobId}`,retryAfterMs: 1000,...(stage?{stage}:{}) };
  }
  async get(jobId: string,accountId: string): Promise<ResolveRecordingResult | null> {
    let job = (await this.query<JobRow>(`${JOB_SELECT} WHERE id=$1::uuid AND account_id=$2::uuid`,[jobId,accountId]))[0];
    if (!job) return null;
    if (!job.result && job.state === "resolving" && job.attempts >= 2) {
      const failure: ResolveRecordingResult = { status: "unavailable",reason: "provider-unavailable",recordingId: job.recordingId,retryable: true };
      const expired = await this.query<JobRow>(`UPDATE sakura_v2."AudioResolveJob" SET state='failed',result=$3::jsonb,lease_until=NULL,updated_at=NOW()
        WHERE id=$1::uuid AND account_id=$2::uuid AND state='resolving' AND attempts>=2 AND (lease_until IS NULL OR lease_until<NOW())
        RETURNING id,account_id AS "accountId",recording_id AS "recordingId",state,result,lease_until AS "leaseUntil",attempts`,[jobId,accountId,JSON.stringify(failure)]);
      if (expired[0]) job = expired[0];
    }
    if (job.result) {const result=this.decoratePreparation(job.result);return this.targets?this.targets.decorate(result,accountId):result;}
    const recording = await this.repository.findById(job.recordingId);
    if (!recording) return { status: "unavailable",reason: "recording-not-indexed",retryable: false };
    return this.pending(job.id,recording);
  }
  process(jobId: string): Promise<void> {
    const current = this.running.get(jobId);
    if (current) return current;
    const pending = this.execute(jobId).finally(() => this.running.delete(jobId));
    this.running.set(jobId,pending);
    return pending;
  }
  private async execute(jobId: string): Promise<void> {
    const job = (await this.query<JobRow>(`UPDATE sakura_v2."AudioResolveJob" SET state='resolving',lease_until=NOW()+INTERVAL '115 seconds',attempts=attempts+1,updated_at=NOW()
      WHERE id=$1::uuid AND attempts<2 AND (state='queued' OR (state='resolving' AND lease_until<NOW()))
      RETURNING id,account_id AS "accountId",recording_id AS "recordingId",state,result,lease_until AS "leaseUntil",attempts`,[jobId]))[0];
    if (!job) return;
    // Discovery includes the original source request, exact catalogue/artist
    // proof and compatibility retries. Their combined budget must fit before
    // preparation starts, and all work must remain inside the 115-second lease.
    const deadline=Date.now()+110000;
    const workSignal=(maximumMs:number)=>AbortSignal.timeout(Math.max(1,Math.min(maximumMs,deadline-Date.now())));
    let result: ResolveRecordingResult;
    try {
      let recording = await this.repository.findById(job.recordingId);
      if (!recording) result = { status: "unavailable",reason: "recording-not-indexed",retryable: false };
      else {
        const reference=recording.references!.find((ref) => ref.provider === "deezer" || ref.provider === "spotify")!;
        const cached = await this.resolver.resolve({ reference },job.accountId);
        if (cached.status === "resolved") {
          if(await this.needsPreparation(cached,job.accountId)){const asset=await this.repository.findAudio(recording.recordingId,cached.playback.assetId,job.accountId);try{if(asset)await this.promotions!.prepare(recording,asset,workSignal(100000));}catch{/* Keep the already verified worker asset as an explicit fallback. */}result=this.decoratePreparation(await this.resolver.resolve({reference},job.accountId));}
          else result = this.decoratePreparation(cached);
        }
        else {
          const discovered = await this.discovery.discover(recording,workSignal(90000));
          if (discovered.status === "ready") {
            if(discovered.verifiedMetadata){recording={...recording,metadata:discovered.verifiedMetadata};await this.ingestor.persistVerifiedAliases(recording);}
            await this.ingestor.persistAudio(recording,discovered.asset);
            if(this.promotions?.needsPreparation(discovered.asset))try{await this.promotions.prepare(recording,discovered.asset,workSignal(60000));}catch{/* Optional CDN preparation failure never recanonicalizes or replaces the worker recording. */}
            result = this.decoratePreparation(await this.resolver.resolve({ reference },job.accountId));
          } else if (discovered.status === "review") result = { status: "review",reason: "asset-mismatch",recordingId: recording.recordingId,candidates: discovered.candidates };
          else result = { status: "unavailable",reason: "no-ready-audio",recordingId: recording.recordingId,retryable: discovered.retryable,sourceReason:/^[a-z0-9-]{1,80}$/.test(discovered.reason)?discovered.reason:"audio-source-unavailable" };
        }
      }
    } catch { result = { status: "unavailable",reason: "provider-unavailable",recordingId: job.recordingId,retryable: true }; }
    await this.query(`UPDATE sakura_v2."AudioResolveJob" SET state=$2,result=$3::jsonb,lease_until=NULL,updated_at=NOW() WHERE id=$1::uuid AND state='resolving' AND attempts=$4`,
      [jobId,result.status === "resolved" ? "ready" : result.status === "review" ? "review" : "failed",JSON.stringify(result),job.attempts]);
  }
}
