import type { PoolClient, QueryResultRow } from "pg";
import { getRebuildPool } from "./db";
import type { ProviderReference } from "../core/types";
import { assessAudioCandidate } from "../core/matching";
import { isUuid,parseRecordingMetadata,supportedAudioMime } from "../server/input";

export interface ReadyPlayback {
  kind:"stream";delivery:"cdn";assetId:string;sizeBytes:number;sha256:string;url:string;fallbackUrl:string;mimeType:string;durationMs:number|null;
}

export interface RecordingCard {
  id: string; recordingId:string; title:string; artists:string[]; durationMs:number|null;
  metadata:Record<string,unknown>; coverUrl:string|null; artistImageUrl:string|null;
  artistId:string|null; albumId:string|null; albumTitle:string|null;
  reference:ProviderReference; references:ProviderReference[];
  genres:string[]; popularity:number; playability:"ready"|"resolvable";
  liked?:boolean;
  artistCredits:{artistId:string|null;name:string;role:"primary"|"featured";reference?:ProviderReference}[];
  readyPlayback?:ReadyPlayback;
}
type Queryable = { query: PoolClient["query"] };
const safeImage = (value:unknown):string|null => {
  if (typeof value !== "string") return null;
  try { const parsed=new URL(value); return parsed.protocol==="https:" ? value : null; } catch {return null;}
};
/** Only the immutable public artifact verified by CDN promotion may bypass a
 * fresh resolver request. Private/source-worker URLs are never projected. */
function readyPlayback(row:QueryResultRow,metadata:Record<string,unknown>,references:ProviderReference[]):ReadyPlayback|undefined {
  const proof=row.readyPlaybackProof as Record<string,unknown>|undefined,cloud=process.env.CLOUDINARY_CLOUD_NAME;
  if(!proof||!cloud||!/^[A-Za-z0-9_-]{1,128}$/.test(cloud)||!isUuid(String(proof.assetId))||typeof proof.sha256!=="string"||!/^[a-f0-9]{64}$/.test(proof.sha256))return;
  const sizeBytes=Number(proof.sizeBytes),delivery=proof.delivery as Record<string,unknown>|undefined;
  if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>120*1024*1024||delivery?.method!=="immutable-cdn-sha256"||delivery.provider!=="cloudinary"||delivery.verifiedSha256!==proof.sha256||!isUuid(String(delivery.sourceAssetId)))return;
  const stamp=typeof delivery.verifiedAt==="string"?Date.parse(delivery.verifiedAt):NaN;
  if(!Number.isFinite(stamp)||stamp<Date.UTC(2000,0,1)||stamp>Date.now()+300000||typeof proof.url!=="string"||typeof proof.mimeType!=="string"||!supportedAudioMime(proof.mimeType))return;
  try{
    const url=new URL(proof.url),path=new RegExp(`^/${cloud}/video/upload/v[1-9]\\d*/sakura/v2/audio/${row.id}/${proof.sha256}\\.mp3$`);
    if(url.origin!=="https://res.cloudinary.com"||url.username||url.password||url.search||url.hash||!path.test(url.pathname))return;
    const parsed=parseRecordingMetadata(metadata),candidate=parseRecordingMetadata(proof.metadata);
    if(!assessAudioCandidate({metadata:parsed,references},{candidateId:String(proof.assetId),metadata:candidate,references:Array.isArray(proof.references)?proof.references as ProviderReference[]:[],audioKind:"full"}).acceptable)return;
    return {kind:"stream",delivery:"cdn",assetId:String(proof.assetId),sizeBytes,sha256:proof.sha256,url:url.href,
      fallbackUrl:`/api/v2/recordings/${row.id}/audio?assetId=${proof.assetId}`,mimeType:proof.mimeType,durationMs:parsed.durationMs??null};
  }catch{return;}
}
export function card(row: QueryResultRow): RecordingCard {
  const metadata = row.metadata as Record<string,unknown>;
  const catalog = (row.provenance?.catalog || {}) as Record<string,unknown>;
  const refs = (Array.isArray(row.references)?row.references:[]) as ProviderReference[];
  const reference = refs.find(r=>r.provider==="deezer"||r.provider==="spotify") || refs[0];
  if (!reference) throw new Error("Verified recording missing catalog reference");
  const rank=Number(metadata.popularity)||0;
  const joined=(Array.isArray(row.artistCredits)?row.artistCredits:[]) as RecordingCard["artistCredits"];
  const credits=(Array.isArray(metadata.artistCredits)?metadata.artistCredits:[]) as RecordingCard["artistCredits"];
  const artistCredits=credits.length?credits.map((credit,i)=>({name:credit.name,role:credit.role|| (i===0?"primary":"featured"),...(credit.reference?{reference:credit.reference}:{}),
    artistId:joined.find(j=>credit.reference&&j.reference?.provider===credit.reference.provider&&j.reference.id===credit.reference.id)?.artistId||null})):
    (Array.isArray(metadata.artists)?metadata.artists:[]).map((name,i)=>({name:String(name),role:i===0?"primary" as const:"featured" as const,
      artistId:joined.find(j=>j.name===name)?.artistId||null,...(joined.find(j=>j.name===name)?.reference?{reference:joined.find(j=>j.name===name)!.reference}:{})}));
  const popularity=rank<=1?rank:rank/(reference.provider==="deezer"?1000000:100);
  const playback=readyPlayback(row,metadata,refs);
  return {id:row.id,recordingId:row.id,title:String(metadata.title),artists:Array.isArray(metadata.artists)?metadata.artists.map(String):[],
    durationMs:typeof metadata.durationMs==="number"?metadata.durationMs:null,metadata,
    coverUrl:safeImage(metadata.coverUrl||catalog.coverUrl),artistImageUrl:safeImage(row.artistImageUrl||metadata.artistImageUrl||catalog.artistImageUrl),
    artistId:row.artistId||null,albumId:row.albumId||null,albumTitle:typeof (metadata.albumTitle||catalog.albumTitle)==="string"?String(metadata.albumTitle||catalog.albumTitle):null,
    reference,references:refs,genres:Array.isArray(metadata.genres)?metadata.genres.map(String):[],
    popularity:Math.max(0,Math.min(1,popularity)),artistCredits,playability:row.ready?"ready":"resolvable",...(playback?{readyPlayback:playback}:{}),...(typeof row.liked==="boolean"?{liked:row.liked}:{})};
}
export const CARD_SELECT = `SELECT r.id,r.metadata,r.provenance,
  COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('provider',e.provider,'id',e.external_id,'scope',NULLIF(e.scope,''))) ORDER BY e.provider,e.external_id)
    FROM sakura_v2."ExternalReference" e WHERE e.recording_id=r.id AND e.verified_at IS NOT NULL),'[]'::jsonb) AS "references",
  (SELECT ra.artist_id FROM sakura_v2."RecordingArtist" ra WHERE ra.recording_id=r.id ORDER BY ra.position,ra.artist_id LIMIT 1) AS "artistId",
  (SELECT a.image_url FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Artist" a ON a.id=ra.artist_id WHERE ra.recording_id=r.id ORDER BY ra.position,ra.artist_id LIMIT 1) AS "artistImageUrl",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('artistId',a.id,'name',a.name,'role',CASE WHEN ra.position=0 THEN 'primary' ELSE 'featured' END,
    'reference',jsonb_build_object('provider',a.provider,'id',a.external_id)) ORDER BY ra.position,a.id)
    FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Artist" a ON a.id=ra.artist_id WHERE ra.recording_id=r.id),'[]'::jsonb) AS "artistCredits",
  (SELECT ra.album_id FROM sakura_v2."RecordingAlbum" ra WHERE ra.recording_id=r.id ORDER BY ra.position,ra.album_id LIMIT 1) AS "albumId",
  (SELECT jsonb_build_object('assetId',a.id,'sizeBytes',a.size_bytes,'sha256',a.sha256,'url',a.locator->>'url','mimeType',a.mime_type,
    'metadata',a.metadata,'references',a.source_references,'delivery',a.evidence->'delivery')
    FROM sakura_v2."AudioAsset" a WHERE a.recording_id=r.id AND a.state='ready' AND a.audio_kind='full' AND a.verified_at IS NOT NULL
      AND a.owner_account_id IS NULL AND a.locator->>'kind'='https' AND a.sha256 IS NOT NULL
      AND a.evidence->'delivery'->>'method'='immutable-cdn-sha256' AND a.evidence->'delivery'->>'provider'='cloudinary'
      AND a.evidence->'delivery'->>'verifiedSha256'=a.sha256
      AND EXISTS(SELECT 1 FROM sakura_v2."AudioAsset" source WHERE source.id::text=a.evidence->'delivery'->>'sourceAssetId'
        AND source.recording_id=r.id AND source.state='ready' AND source.audio_kind='full' AND source.verified_at IS NOT NULL
        AND source.owner_account_id IS NULL AND source.sha256=a.sha256 AND source.size_bytes=a.size_bytes)
    ORDER BY a.verified_at DESC,a.id LIMIT 1) AS "readyPlaybackProof",
  EXISTS(SELECT 1 FROM sakura_v2."AudioAsset" a WHERE a.recording_id=r.id AND a.state='ready' AND a.audio_kind='full'
    AND (a.owner_account_id IS NULL OR a.owner_account_id=$1::uuid)) AS ready
  FROM sakura_v2."Recording" r`;
export const VERIFIED = `r.state='verified' AND EXISTS(SELECT 1 FROM sakura_v2."ExternalReference" e WHERE e.recording_id=r.id AND e.verified_at IS NOT NULL)`;

export async function cardsForIds(accountId:string,recordingIds:readonly string[],sql:Queryable=getRebuildPool()):Promise<RecordingCard[]> {
  if (!recordingIds.length) return [];
  const rows=await sql.query(`${CARD_SELECT} WHERE ${VERIFIED} AND r.id=ANY($2::uuid[])`,[accountId,recordingIds]);
  const map=new Map(rows.rows.map(row=>[row.id,card(row)]));
  return recordingIds.flatMap(id=>map.has(id)?[map.get(id)!]:[]);
}

/** Canonical catalog projections preserve exact provider identity and one shared
 * artwork field. Missing images remain null; no artist-name guessing is used. */
export async function syncCatalog(sql:Queryable=getRebuildPool()):Promise<void> {
  await sql.query(`INSERT INTO sakura_v2."Artist"(provider,external_id,name,image_url,provenance)
    SELECT DISTINCT ON (ref->>'provider',ref->>'id') ref->>'provider',ref->>'id',metadata->'artists'->>0,
      COALESCE(metadata->>'artistImageUrl',provenance->'catalog'->>'artistImageUrl'),jsonb_build_object('catalog',ref)
    FROM sakura_v2."Recording",LATERAL (SELECT COALESCE(metadata->'artistReference',provenance->'catalog'->'artistReference') AS ref) refs
    WHERE state='verified' AND ref->>'provider' IN ('deezer','spotify') AND length(ref->>'id')>0 AND length(metadata->'artists'->>0)>0
    ORDER BY ref->>'provider',ref->>'id',updated_at DESC
    ON CONFLICT(provider,external_id) DO UPDATE SET name=EXCLUDED.name,image_url=COALESCE(EXCLUDED.image_url,sakura_v2."Artist".image_url),updated_at=now()`);
  await sql.query(`INSERT INTO sakura_v2."RecordingArtist"(recording_id,artist_id,position)
    SELECT r.id,a.id,0 FROM sakura_v2."Recording" r JOIN sakura_v2."Artist" a
    ON a.provider=COALESCE(r.metadata->'artistReference',r.provenance->'catalog'->'artistReference')->>'provider'
      AND a.external_id=COALESCE(r.metadata->'artistReference',r.provenance->'catalog'->'artistReference')->>'id'
    WHERE r.state='verified' ON CONFLICT DO NOTHING`);
  await sql.query(`INSERT INTO sakura_v2."Album"(provider,external_id,title,artist_id,cover_url,provenance)
    SELECT DISTINCT ON(ref->>'provider',ref->>'id') ref->>'provider',ref->>'id',COALESCE(r.metadata->>'albumTitle',r.provenance->'catalog'->>'albumTitle'),
      (SELECT ra.artist_id FROM sakura_v2."RecordingArtist" ra WHERE ra.recording_id=r.id ORDER BY ra.position LIMIT 1),
      COALESCE(r.metadata->>'coverUrl',r.provenance->'catalog'->>'coverUrl'),jsonb_build_object('catalog',ref)
    FROM sakura_v2."Recording" r,LATERAL(SELECT COALESCE(r.metadata->'albumReference',r.provenance->'catalog'->'albumReference') ref) refs
    WHERE r.state='verified' AND ref->>'provider' IN ('deezer','spotify') AND length(ref->>'id')>0
      AND length(COALESCE(r.metadata->>'albumTitle',r.provenance->'catalog'->>'albumTitle'))>0
    ORDER BY ref->>'provider',ref->>'id',r.updated_at DESC
    ON CONFLICT(provider,external_id) DO UPDATE SET title=EXCLUDED.title,artist_id=COALESCE(EXCLUDED.artist_id,sakura_v2."Album".artist_id),
      cover_url=COALESCE(EXCLUDED.cover_url,sakura_v2."Album".cover_url),updated_at=now()`);
  await sql.query(`INSERT INTO sakura_v2."RecordingAlbum"(recording_id,album_id,position)
    SELECT r.id,a.id,COALESCE((r.metadata->>'trackPosition')::integer,0) FROM sakura_v2."Recording" r JOIN sakura_v2."Album" a
    ON a.provider=COALESCE(r.metadata->'albumReference',r.provenance->'catalog'->'albumReference')->>'provider'
      AND a.external_id=COALESCE(r.metadata->'albumReference',r.provenance->'catalog'->'albumReference')->>'id'
    WHERE r.state='verified' ON CONFLICT DO NOTHING`);
}
