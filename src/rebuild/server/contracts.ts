import type { AudioCandidate, CanonicalRecording, ProviderReference, RecordingMetadata,ArtistCredit } from "../core/types";

export interface CatalogRecording {
  reference: ProviderReference;
  references: readonly ProviderReference[];
  metadata: RecordingMetadata;
  coverUrl?: string;
  artistImageUrl?: string;
  albumTitle?: string;
  artistReference?: ProviderReference;
  albumReference?: ProviderReference;
  artistCredits?:readonly ArtistCredit[];
  genres?: readonly string[];
  popularity?: number;
  artistId?: string | null;
  albumId?: string | null;
}

export interface CatalogProvider {
  readonly provider: "deezer" | "spotify";
  getExact(reference: ProviderReference, signal?: AbortSignal): Promise<CatalogRecording | null>;
  /** Candidates are still fetched by exact provider ID and checked against the ISRC. */
  getByIsrc?(isrc: string, signal?: AbortSignal): Promise<readonly CatalogRecording[]>;
}

export type AudioLocator =
  | { kind: "https"; url: string }
  | { kind: "telegram-worker"; messageId: string; chatScope: string; protocol?: "v1" | "v2"; documentId?: string };

export interface StoredAudioAsset {
  assetId: string;
  recordingId: string;
  candidate: AudioCandidate;
  locator: AudioLocator;
  state: "ready" | "unavailable";
  verifiedAt: string;
  mimeType: string;
  sizeBytes: number;
  /** Full-file digest is independent evidence that duplicate assets share bytes. */
  sha256?: string;
  deliveryEvidence?:{method:"immutable-cdn-sha256";provider:"cloudinary";sourceAssetId:string;verifiedSha256:string;verifiedAt:string};
  /** Null is a catalogue asset; a private asset is only accessible to its owner. */
  ownerAccountId: string | null;
}

/** Queries only. A separate verified ingestion transaction owns all catalogue writes. */
export interface RecordingRepository {
  readonly initialized: boolean;
  findByReference(reference: ProviderReference): Promise<CanonicalRecording | null>;
  findById(recordingId: string): Promise<CanonicalRecording | null>;
  listAudio(recordingId: string, accountId: string): Promise<readonly StoredAudioAsset[]>;
  findAudio(recordingId: string, assetId: string, accountId: string): Promise<StoredAudioAsset | null>;
}

export interface ResolveRecordingInput {
  reference: ProviderReference;
  /** Display metadata the listener selected, to expose catalog/variant disagreements. */
  expected?: RecordingMetadata;
}

export type ReviewReason = "catalog-mismatch" | "asset-mismatch" | "ambiguous-audio" | "identity-conflict";
export interface ReviewCandidate {
  title: string;
  artists: readonly string[];
  durationMs: number | null;
  reference?: ProviderReference;
  assetId?: string;
  reasons: readonly string[];
}

export type ResolveRecordingResult =
  | { status: "pending"; jobId: string; recording: CanonicalRecording; pollUrl: string; retryAfterMs: number; stage?:"finding-source"|"preparing-audio" }
  | {
    status: "resolved";
    recording: CanonicalRecording;
    playback: { kind: "stream"; assetId: string; url: string; fallbackUrl?:string; mimeType: string; sizeBytes: number; durationMs: number | null; sha256?:string;delivery?:"cdn"|"worker-fallback"; preparationFailure?:string };
  }
  | { status: "review"; reason: ReviewReason; candidates: readonly ReviewCandidate[]; recordingId?: string }
  | {
    status: "unavailable";
    reason: "unsupported-provider" | "catalog-not-found" | "provider-unavailable" | "backend-unavailable" | "backend-not-initialized" | "recording-not-indexed" | "no-ready-audio";
    catalog?: CatalogRecording;
    recordingId?: string;
    retryable: boolean;
    /** Safe, bounded provider diagnostic; never a raw upstream error or URL. */
    sourceReason?: string;
  };

export class ProviderError extends Error {
  constructor(readonly code: "timeout" | "unavailable" | "invalid-response" | "not-configured", message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export class InputError extends Error {
  constructor(message: string) { super(message); this.name = "InputError"; }
}
