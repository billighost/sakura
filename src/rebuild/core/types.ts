/** IDs identify recordings, provider references identify catalogue entries, queue IDs identify occurrences. */
export type RecordingId = string;

export type RecordingVersionKind =
  | "remix" | "live" | "acoustic" | "instrumental" | "karaoke" | "demo"
  | "sped-up" | "slowed" | "edit" | "remaster";

export interface RecordingVersion {
  kinds: readonly RecordingVersionKind[];
  /** A named mix, venue, year or edit is significant; never discard it to deduplicate. */
  labels: readonly string[];
}

export interface ProviderReference {
  provider: "deezer" | "spotify" | "musicbrainz" | "isrc" | "telegram" | "legacy";
  id: string;
  /** Telegram message IDs are only unique within a chat. */
  scope?: string;
}

export interface RecordingMetadata {
  title: string;
  /** Primary artist first, featured artists after. */
  artists: readonly string[];
  /** Search summaries may omit featured credits; exact recordings are complete. */
  artistsComplete?:boolean;
  durationMs?: number | null;
  version?: RecordingVersion;
  explicit?: "unknown" | "clean" | "explicit";
  /** Trusted server-only catalogue spellings, each bound to verified recording
   * references. Public expected metadata must never populate this field. */
  verifiedAliases?: readonly VerifiedRecordingMetadataAlias[];
}

export interface VerifiedRecordingMetadataAlias {
  metadata: Omit<RecordingMetadata, "verifiedAliases">;
  references: readonly ProviderReference[];
}
export type VerifiedRecordingAlias = VerifiedRecordingMetadataAlias;

export interface RecordingRequest {
  metadata: RecordingMetadata;
  references?: readonly ProviderReference[];
}

export interface ArtistCredit {
  name:string;
  role:"primary"|"featured";
  reference?:ProviderReference;
}

export interface AudioCandidate extends RecordingRequest {
  candidateId: string;
  /** Must be set by the provider adapter, never inferred from a truthy URL. */
  audioKind: "full" | "preview" | "unknown";
  bitrateKbps?: number;
}

export interface CanonicalRecording extends RecordingRequest {
  recordingId: RecordingId;
  coverUrl?: string;
  artistImageUrl?: string;
  albumTitle?: string;
  artistId?: string | null;
  albumId?: string | null;
  artistReference?: ProviderReference;
  albumReference?: ProviderReference;
  artistCredits?:readonly ArtistCredit[];
}
