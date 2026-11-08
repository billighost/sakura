import { referenceKey } from "../core/identity";
import type { CanonicalRecording, ProviderReference,ArtistCredit } from "../core/types";
import { parseRecordingMetadata, parseTrustedRecordingMetadata, isUuid } from "./input";
import type { AudioLocator, RecordingRepository, StoredAudioAsset } from "./contracts";

export const UNINITIALIZED_REPOSITORY: RecordingRepository = {
  initialized: false,
  async findByReference() { return null; },
  async findById() { return null; },
  async listAudio() { return []; },
  async findAudio() { return null; },
};

/** Injectable reads allow service tests and a read-only database account in deployment. */
export type ReadonlySql = <Row>(statement: string, parameters: readonly unknown[]) => Promise<Row[]>;
interface RecordingRow { id: string; metadata: unknown; references: unknown; artistId?: string | null; albumId?: string | null }
interface AssetRow { id: string; recordingId: string; metadata: unknown; references: unknown; locator: unknown; state: string; verifiedAt: Date | string; mimeType: string; sizeBytes: string | number; sha256?:string|null; evidence?:unknown; ownerAccountId: string | null }

function references(value: unknown): ProviderReference[] {
  if (!Array.isArray(value)) throw new Error("Stored provider references are malformed");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Stored provider reference is malformed");
    const raw = item as ProviderReference & {scope?:string|null};
    const ref:ProviderReference={provider:raw.provider,id:raw.id,...(raw.scope==null?{}:{scope:raw.scope})};
    if (!["deezer", "spotify", "musicbrainz", "isrc", "telegram", "legacy"].includes(ref.provider) || typeof ref.id !== "string" || (ref.scope !== undefined && typeof ref.scope !== "string")) throw new Error("Stored provider reference is malformed");
    referenceKey(ref);
    return { ...ref };
  });
}
function recording(row: RecordingRow): CanonicalRecording {
  if (!isUuid(row.id)) throw new Error("Stored canonical recording ID is malformed");
  const extra = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const artistCredits:ArtistCredit[]=(Array.isArray(extra.artistCredits)?extra.artistCredits:[]).flatMap(value=>{
    if(!value||typeof value!=="object")return[];const credit=value as ArtistCredit;
    if(typeof credit.name!=="string"||(credit.role!=="primary"&&credit.role!=="featured"))return[];
    try{return[{name:credit.name,role:credit.role,...(credit.reference?{reference:references([credit.reference])[0]}:{})}];}catch{return[];}
  });
  return { recordingId: row.id, metadata: parseTrustedRecordingMetadata(row.metadata), references: references(row.references),
    coverUrl: typeof extra.coverUrl === "string" ? extra.coverUrl : undefined, albumTitle: typeof extra.albumTitle === "string" ? extra.albumTitle : undefined,
    artistImageUrl: typeof extra.artistImageUrl === "string" ? extra.artistImageUrl : undefined,
    artistReference: extra.artistReference as ProviderReference | undefined, albumReference: extra.albumReference as ProviderReference | undefined,
    artistId: row.artistId ?? null, albumId: row.albumId ?? null,...(artistCredits.length?{artistCredits}: {}) };
}
function locator(value: unknown): AudioLocator {
  if (!value || typeof value !== "object") throw new Error("Stored audio locator is malformed");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "https" && typeof raw.url === "string") return { kind: "https", url: raw.url };
  if (raw.kind === "telegram-worker" && typeof raw.messageId === "string" && /^[1-9]\d{0,14}$/.test(raw.messageId) && typeof raw.chatScope === "string" && raw.chatScope.trim()) {
    if(raw.documentId!==undefined&&(typeof raw.documentId!=="string"||! /^-?\d{1,25}$/.test(raw.documentId)))throw new Error("Stored worker document identity is malformed");
    return { kind: "telegram-worker", messageId: raw.messageId, chatScope: raw.chatScope, protocol: raw.protocol === "v2" ? "v2" : "v1",...(typeof raw.documentId==="string"?{documentId:raw.documentId}:{}) };
  }
  throw new Error("Stored audio locator is malformed");
}
function asset(row: AssetRow): StoredAudioAsset {
  const sizeBytes = Number(row.sizeBytes);
  const verifiedAt = new Date(row.verifiedAt).toISOString();
  if (!isUuid(row.id) || !isUuid(row.recordingId) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !row.mimeType.startsWith("audio/")) throw new Error("Stored audio asset is malformed");
  const location=locator(row.locator),proof=(row.evidence&&typeof row.evidence==="object"?(row.evidence as Record<string,unknown>).delivery:undefined)as StoredAudioAsset["deliveryEvidence"];
  const deliveryEvidence=proof&&location.kind==="https"&&row.ownerAccountId===null&&proof.method==="immutable-cdn-sha256"&&proof.provider==="cloudinary"
    &&isUuid(proof.sourceAssetId)&&typeof row.sha256==="string"&&/^[a-f0-9]{64}$/.test(row.sha256)&&proof.verifiedSha256===row.sha256
    &&typeof proof.verifiedAt==="string"&&Number.isFinite(Date.parse(proof.verifiedAt))?proof:undefined;
  return { assetId: row.id, recordingId: row.recordingId,
    candidate: { candidateId: row.id, metadata: parseRecordingMetadata(row.metadata), references: references(row.references), audioKind: "full" },
    locator: location, state: row.state === "ready" ? "ready" : "unavailable", verifiedAt,...(deliveryEvidence?{deliveryEvidence}:{}),
    mimeType: row.mimeType, sizeBytes,...(typeof row.sha256==="string"&&/^[a-f0-9]{64}$/.test(row.sha256)?{sha256:row.sha256}:{}),ownerAccountId: row.ownerAccountId,
  };
}

const RECORDING_SELECT = `SELECT r.id, r.metadata,
  (SELECT ra.artist_id FROM sakura_v2."RecordingArtist" ra WHERE ra.recording_id = r.id ORDER BY ra.position LIMIT 1) AS "artistId",
  (SELECT ra.album_id FROM sakura_v2."RecordingAlbum" ra WHERE ra.recording_id = r.id ORDER BY ra.position LIMIT 1) AS "albumId",
  COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('provider', e.provider, 'id', e.external_id,
    'scope', NULLIF(e.scope, '')))) FROM sakura_v2."ExternalReference" e
    WHERE e.recording_id = r.id AND e.verified_at IS NOT NULL), '[]'::jsonb) AS "references"
  FROM sakura_v2."Recording" r`;
const ASSET_SELECT = `SELECT a.id, a.recording_id AS "recordingId", a.metadata, a.source_references AS "references", a.locator,
  a.state, a.verified_at AS "verifiedAt", a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes",a.sha256,a.evidence,
  a.owner_account_id AS "ownerAccountId" FROM sakura_v2."AudioAsset" a`;

/** Uses only the new schema. It never queries, mutates or guesses from old Track rows. */
export class PostgresRecordingRepository implements RecordingRepository {
  readonly initialized = true;
  constructor(private readonly query: ReadonlySql) {}
  async findByReference(ref: ProviderReference) {
    const [provider, scope, id] = JSON.parse(referenceKey(ref)) as [string, string, string];
    const rows = await this.query<RecordingRow>(`${RECORDING_SELECT}
      JOIN sakura_v2."ExternalReference" requested ON requested.recording_id = r.id
      WHERE requested.provider = $1 AND requested.scope = $2 AND requested.external_id = $3
        AND requested.verified_at IS NOT NULL AND r.state = 'verified' LIMIT 1`, [provider, scope, id]);
    return rows[0] ? recording(rows[0]) : null;
  }
  async findById(recordingId: string) {
    if (!isUuid(recordingId)) return null;
    const rows = await this.query<RecordingRow>(`${RECORDING_SELECT} WHERE r.id = $1::uuid AND r.state = 'verified' LIMIT 1`, [recordingId]);
    return rows[0] ? recording(rows[0]) : null;
  }
  async listAudio(recordingId: string, accountId: string) {
    if (!isUuid(recordingId) || !isUuid(accountId)) return [];
    const rows = await this.query<AssetRow>(`${ASSET_SELECT} WHERE a.recording_id = $1::uuid
      AND (a.owner_account_id IS NULL OR a.owner_account_id = $2::uuid)
      AND a.state = 'ready' AND a.audio_kind = 'full' AND a.verified_at IS NOT NULL
      ORDER BY a.verified_at DESC, a.id`, [recordingId, accountId]);
    return rows.map(asset);
  }
  async findAudio(recordingId: string, assetId: string, accountId: string) {
    if (!isUuid(recordingId) || !isUuid(assetId) || !isUuid(accountId)) return null;
    const rows = await this.query<AssetRow>(`${ASSET_SELECT} WHERE a.recording_id = $1::uuid AND a.id = $2::uuid
      AND (a.owner_account_id IS NULL OR a.owner_account_id = $3::uuid)
      AND a.state = 'ready' AND a.audio_kind = 'full' AND a.verified_at IS NOT NULL LIMIT 1`, [recordingId, assetId, accountId]);
    return rows[0] ? asset(rows[0]) : null;
  }
}
