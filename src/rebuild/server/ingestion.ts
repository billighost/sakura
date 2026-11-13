import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assessAudioCandidate,verifiedRecordingAliases,type MatchRejection } from "../core/matching";
import { referenceKey } from "../core/identity";
import type { CanonicalRecording, ProviderReference,ArtistCredit } from "../core/types";
import type { CatalogProvider, CatalogRecording, StoredAudioAsset } from "./contracts";
import { parseRecordingMetadata,parseTrustedRecordingMetadata, supportedAudioMime,isUuid } from "./input";
import type { ReadonlySql } from "./repository";
import { CatalogMetadataAliases,withVerifiedCatalogAliases } from "./metadata-aliases";

export type SqlTransaction = <Value>(operation: (query: ReadonlySql) => Promise<Value>) => Promise<Value>;
export class RecordingIdentityConflict extends Error {
  constructor(readonly candidates:readonly CanonicalRecording[],readonly reason:"catalog-mismatch"|"identity-conflict"="identity-conflict",readonly rejections:readonly MatchRejection[]=["identifier-conflict"]){
    super(reason==="catalog-mismatch"?"The selected song details do not match this catalog recording. Choose the exact version.":"These catalog references need a recording review. Choose another recording.");this.name="RecordingIdentityConflict";
  }
}

function metadataWithArtwork(catalog: CatalogRecording) {
  return { ...catalog.metadata, coverUrl: catalog.coverUrl, albumTitle: catalog.albumTitle, artistImageUrl: catalog.artistImageUrl,
    artistReference: catalog.artistReference, albumReference: catalog.albumReference,...(catalog.artistCredits?{artistCredits:catalog.artistCredits}:{}),
    ...(catalog.genres!==undefined?{genres:catalog.genres}:{}),...(catalog.popularity!==undefined?{popularity:catalog.popularity}:{}) };
}

/** Exact catalog ingestion is independent of audio discovery and offline downloads. */
export class RecordingIngestor {
  private readonly metadataAliases:CatalogMetadataAliases;
  constructor(private readonly transaction: SqlTransaction, private readonly providers: readonly CatalogProvider[]) {this.metadataAliases=new CatalogMetadataAliases(providers);}
  async hydrateVerifiedAliases(recording:CanonicalRecording,signal?:AbortSignal):Promise<CanonicalRecording>{
    const enriched=await this.metadataAliases.hydrate(recording,signal);
    if(enriched!==recording)await this.persistVerifiedAliases(enriched);
    return enriched;
  }
  async persistVerifiedAliases(recording:CanonicalRecording):Promise<void>{
    const aliases=verifiedRecordingAliases(recording);if(!aliases.length)return;
    await this.transaction(async query=>{await query(`UPDATE sakura_v2."Recording" SET metadata=jsonb_set(metadata,'{verifiedAliases}',$2::jsonb,true),updated_at=NOW() WHERE id=$1::uuid AND state='verified'`,[recording.recordingId,JSON.stringify(aliases)]);});
  }
  async ensureRecording(reference: ProviderReference, expected?: CanonicalRecording["metadata"], signal?: AbortSignal): Promise<CanonicalRecording> {
    const provider = this.providers.find((entry) => entry.provider === reference.provider);
    if (!provider) throw new Error("Catalogue provider is not configured");
    let catalog = await provider.getExact(reference, signal);
    if (!catalog) throw new Error("Catalogue recording was not found");
    if(expected){
      const display=parseRecordingMetadata(expected);
      let check=assessAudioCandidate(catalog,{candidateId:"expected",metadata:display,references:[reference],audioKind:"full"});
      if(!check.acceptable&&check.reasons.every(reason=>reason==="title"||reason==="artist")){
        const enriched=await this.metadataAliases.hydrate({recordingId:referenceKey(reference),metadata:catalog.metadata,references:catalog.references},signal);
        catalog={...catalog,metadata:enriched.metadata};check=assessAudioCandidate(catalog,{candidateId:"expected",metadata:display,references:[reference],audioKind:"full"});
      }
      if(!check.acceptable)throw new RecordingIdentityConflict([{recordingId:"",metadata:catalog.metadata,references:catalog.references,coverUrl:catalog.coverUrl}],"catalog-mismatch",check.reasons);
    }
    signal?.throwIfAborted();
    return this.ensureCatalog(catalog);
  }
  /** Ordered, bounded catalog-only acquisition. Committed descriptive rows
   * survive a failed batch, just as they do with individual index requests. */
  async ensureRecordings(items:readonly {reference:ProviderReference;expected?:CanonicalRecording["metadata"]}[],signal?:AbortSignal):Promise<CanonicalRecording[]>{
    if(items.length<1||items.length>50)throw new RangeError("Catalog batch supports 1–50 recordings");
    signal?.throwIfAborted();
    const stop=new AbortController(),shared=signal?AbortSignal.any([signal,stop.signal]):stop.signal;
    const result=new Array<CanonicalRecording>(items.length);let next=0;
    await Promise.allSettled(Array.from({length:Math.min(3,items.length)},async()=>{
      while(next<items.length&&!shared.aborted){const index=next++,item=items[index];
        try{result[index]=await this.ensureRecording(item.reference,item.expected,shared);}
        catch(error){stop.abort(error);throw error;}
      }
    }));
    shared.throwIfAborted();return result;
  }
  async ensureCatalog(catalog: CatalogRecording): Promise<CanonicalRecording> {
    const authoritative = catalog.references.filter((ref) => ref.provider === "isrc" || ref.provider === "musicbrainz");
    const lock = referenceKey(authoritative[0] ?? catalog.reference);
    return this.transaction(async (query) => {
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
      const requested=catalog.references.map(ref=>{const [provider,scope,id]=JSON.parse(referenceKey(ref)) as string[];return {provider,scope,id};});
      const credits:readonly ArtistCredit[]=catalog.artistCredits??(catalog.artistReference?[{name:catalog.metadata.artists[0],role:"primary",reference:catalog.artistReference}]:[]);
      const credited=[...new Map(credits.flatMap((credit,position)=>credit.reference?[[referenceKey(credit.reference),{provider:credit.reference.provider,id:credit.reference.id,name:credit.name,image:credit.role==="primary"?catalog.artistImageUrl??null:null,position,reference:credit.reference}]]:[])).values()];
      const primary=[...credits].reverse().find(credit=>credit.role==="primary"&&credit.reference);
      const projection=JSON.stringify({artist:primary?.reference??null,album:catalog.albumReference&&catalog.albumTitle?catalog.albumReference:null});
      type ExistingRow={id:string;metadata:Record<string,unknown>;references:readonly ProviderReference[];catalogIngestionSignature?:string;artistId?:string|null;albumId?:string|null;artistProjections?:{provider:string;id:string;position:number}[]};
      const found=await query<ExistingRow>(`SELECT DISTINCT ON(r.id) r.id,r.metadata,r.provenance->>'catalogIngestionSignature' AS "catalogIngestionSignature",
          (SELECT ra.artist_id FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Artist" a ON a.id=ra.artist_id
            WHERE ra.recording_id=r.id AND a.provider=$2::jsonb->'artist'->>'provider' AND a.external_id=$2::jsonb->'artist'->>'id' LIMIT 1) AS "artistId",
          (SELECT ra.album_id FROM sakura_v2."RecordingAlbum" ra JOIN sakura_v2."Album" a ON a.id=ra.album_id
            WHERE ra.recording_id=r.id AND a.provider=$2::jsonb->'album'->>'provider' AND a.external_id=$2::jsonb->'album'->>'id' LIMIT 1) AS "albumId",
          COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',a.provider,'id',a.external_id,'position',ra.position))
            FROM sakura_v2."RecordingArtist" ra JOIN sakura_v2."Artist" a ON a.id=ra.artist_id WHERE ra.recording_id=r.id),'[]'::jsonb) AS "artistProjections",
          COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('provider',proof.provider,'id',proof.external_id,'scope',NULLIF(proof.scope,''))))
            FROM sakura_v2."ExternalReference" proof WHERE proof.recording_id=r.id AND proof.verified_at IS NOT NULL),'[]'::jsonb) AS "references"
          FROM sakura_v2."ExternalReference" e JOIN sakura_v2."Recording" r ON r.id=e.recording_id
          JOIN jsonb_to_recordset($1::jsonb) requested(provider text,scope text,id text)
            ON requested.provider=e.provider AND requested.scope=e.scope AND requested.id=e.external_id
          WHERE e.verified_at IS NOT NULL ORDER BY r.id`,[JSON.stringify(requested),projection]);
      const matches = new Map<string, CanonicalRecording>(found.map(row=>[row.id,{recordingId:row.id,metadata:parseTrustedRecordingMetadata(row.metadata),references:row.references??[]}]));
      if (matches.size > 1) throw new RecordingIdentityConflict([...matches.values()]);
      const existing = [...matches.values()][0];
      if(existing){
        const priorAliases=verifiedRecordingAliases(existing).map(alias=>({...catalog,metadata:alias.metadata,references:alias.references}));
        const metadata=withVerifiedCatalogAliases(catalog,[{...catalog,metadata:existing.metadata,references:existing.references??[]},...priorAliases]);
        catalog={...catalog,metadata};
        existing.metadata=withVerifiedCatalogAliases(existing,[catalog]);
      }
      if (existing && !assessAudioCandidate(existing, { candidateId: "catalog", metadata: catalog.metadata, references: catalog.references, audioKind: "full" }).acceptable) throw new RecordingIdentityConflict([existing]);
      const recordingId = existing?.recordingId ?? randomUUID();
      const metadata = metadataWithArtwork(catalog);
      const signature=createHash("sha256").update(JSON.stringify([metadata,catalog.references,catalog.artistCredits,catalog.artistReference,catalog.albumReference,catalog.albumTitle])).digest("hex");
      const stored=found.find(row=>row.id===recordingId);
      const completeProof=catalog.references.every(ref=>(stored?.references||[]).some(proof=>referenceKey(proof)===referenceKey(ref)));
      const completeProjection=(!credited.length||stored?.artistProjections?.length===credited.length&&credited.every(credit=>stored.artistProjections!.some(proof=>proof.provider===credit.provider&&proof.id===credit.id&&proof.position===credit.position)))
        &&(!catalog.albumReference||!catalog.albumTitle||Boolean(stored?.albumId));
      const unchanged=stored&&Object.entries(metadata).every(([key,value])=>value===undefined||isDeepStrictEqual(stored.metadata[key],value));
      const result=(artistId:string|null,albumId:string|null):CanonicalRecording=>({recordingId,metadata:catalog.metadata,references:catalog.references,coverUrl:catalog.coverUrl,artistImageUrl:catalog.artistImageUrl,albumTitle:catalog.albumTitle,
        artistReference:catalog.artistReference,albumReference:catalog.albumReference,artistCredits:catalog.artistCredits,artistId,albumId});
      if(completeProof&&completeProjection&&unchanged&&stored?.catalogIngestionSignature===signature)return result(stored.artistId||null,stored.albumId||null);
      if (!existing) await query(`INSERT INTO sakura_v2."Recording"(id,metadata,state,provenance) VALUES($1::uuid,$2::jsonb,'verified',$3::jsonb)`, [recordingId, JSON.stringify(metadata), JSON.stringify({ catalog, catalogIngestionSignature:signature,indexedAt: new Date().toISOString() })]);
      else await query(`UPDATE sakura_v2."Recording" SET metadata=metadata || $2::jsonb,
        provenance=provenance||jsonb_build_object('catalogIngestionSignature',$3::text),updated_at=NOW() WHERE id=$1::uuid
        AND (metadata IS DISTINCT FROM metadata||$2::jsonb OR provenance->>'catalogIngestionSignature' IS DISTINCT FROM $3::text)`, [recordingId, JSON.stringify(metadata),signature]);
      await query(`INSERT INTO sakura_v2."ExternalReference"(provider,scope,external_id,recording_id,verified_at,evidence)
        SELECT x.provider,x.scope,x.id,$2::uuid,NOW(),$3::jsonb FROM jsonb_to_recordset($1::jsonb) x(provider text,scope text,id text)
        ON CONFLICT(provider,scope,external_id) DO NOTHING`,[JSON.stringify(requested),recordingId,JSON.stringify({exactCatalogReference:catalog.reference})]);
      // A separate statement observes a concurrent ON CONFLICT winner. A CTE
      // read in the INSERT snapshot could miss that row and weaken the proof.
      const bound=await query<{provider:string;scope:string;external_id:string;recording_id:string}>(`SELECT e.provider,e.scope,e.external_id,e.recording_id FROM sakura_v2."ExternalReference" e
        JOIN jsonb_to_recordset($1::jsonb) requested(provider text,scope text,id text)
          ON requested.provider=e.provider AND requested.scope=e.scope AND requested.id=e.external_id`,[JSON.stringify(requested)]);
      const bindings=new Map(bound.map(row=>[JSON.stringify([row.provider,row.scope,row.external_id]),row.recording_id]));
      if(requested.some(ref=>bindings.get(JSON.stringify([ref.provider,ref.scope,ref.id]))!==recordingId))throw new RecordingIdentityConflict(existing?[existing]:[]);
      let artistId: string | null = null;
      let albumId: string | null = null;
      const artists=credited.length?await query<{id:string;provider:string;external_id:string}>(`INSERT INTO sakura_v2."Artist"(provider,external_id,name,image_url,provenance)
        SELECT x.provider,x.id,x.name,x.image,jsonb_build_object('reference',x.reference) FROM jsonb_to_recordset($1::jsonb) x(provider text,id text,name text,image text,reference jsonb)
        ON CONFLICT(provider,external_id) DO UPDATE SET name=EXCLUDED.name,image_url=COALESCE(EXCLUDED.image_url,sakura_v2."Artist".image_url),updated_at=NOW()
        RETURNING id,provider,external_id`,[JSON.stringify(credited)]):[];
      const artistIds=new Map(artists.map(artist=>[JSON.stringify([artist.provider,"",artist.external_id]),artist.id]));
      const projections=credited.flatMap(credit=>{const id=artistIds.get(referenceKey(credit.reference));return id?[{id,position:credit.position}]:[];});
      artistId=primary?.reference?artistIds.get(referenceKey(primary.reference))||null:null;
      const creditIds=projections.map(credit=>credit.id);
      if(projections.length)await query(`INSERT INTO sakura_v2."RecordingArtist"(recording_id,artist_id,position)
        SELECT $1::uuid,x.id,x.position FROM jsonb_to_recordset($2::jsonb) x(id uuid,position integer)
        ON CONFLICT(recording_id,artist_id) DO UPDATE SET position=EXCLUDED.position
        WHERE sakura_v2."RecordingArtist".position IS DISTINCT FROM EXCLUDED.position`,[recordingId,JSON.stringify(projections)]);
      // Exact new credits replace superseded provider projections atomically.
      // Artist entities and personal data are retained; names never merge IDs.
      if(creditIds.length)await query(`DELETE FROM sakura_v2."RecordingArtist" WHERE recording_id=$1::uuid AND NOT(artist_id=ANY($2::uuid[]))`,[recordingId,creditIds]);
      if (catalog.albumReference && catalog.albumTitle) {
        const album = await query<{ id: string }>(`INSERT INTO sakura_v2."Album"(provider,external_id,title,artist_id,cover_url,provenance) VALUES($1,$2,$3,$4::uuid,$5,$6::jsonb)
          ON CONFLICT(provider,external_id) DO UPDATE SET title=EXCLUDED.title,cover_url=COALESCE(EXCLUDED.cover_url,sakura_v2."Album".cover_url),updated_at=NOW() RETURNING id`, [catalog.albumReference.provider,catalog.albumReference.id,catalog.albumTitle,artistId,catalog.coverUrl ?? null,JSON.stringify({ reference: catalog.albumReference })]);
        albumId = album[0]?.id ?? null;
        if (albumId) await query(`INSERT INTO sakura_v2."RecordingAlbum"(recording_id,album_id,position) VALUES($1::uuid,$2::uuid,0) ON CONFLICT DO NOTHING`, [recordingId,albumId]);
      }
      return result(artistId,albumId);
    });
  }
  async persistAudio(recording: CanonicalRecording, asset: StoredAudioAsset): Promise<void> {
    if(asset.deliveryEvidence&&(!isUuid(asset.deliveryEvidence.sourceAssetId)||asset.deliveryEvidence.method!=="immutable-cdn-sha256"||asset.deliveryEvidence.provider!=="cloudinary"||asset.deliveryEvidence.verifiedSha256!==asset.sha256||asset.locator.kind!=="https"||asset.ownerAccountId!==null||!Number.isFinite(Date.parse(asset.deliveryEvidence.verifiedAt))))throw new Error("CDN delivery evidence failed validation");
    if (asset.recordingId !== recording.recordingId || asset.candidate.audioKind !== "full" || asset.state !== "ready" || !supportedAudioMime(asset.mimeType)
      || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || (asset.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(asset.sha256)) || !assessAudioCandidate(recording, asset.candidate).acceptable) throw new Error("Audio source failed recording validation");
    await this.transaction(async (query) => {
      await query(`INSERT INTO sakura_v2."AudioAsset"(id,recording_id,metadata,source_references,locator,audio_kind,state,mime_type,size_bytes,verified_at,owner_account_id,evidence,sha256)
        VALUES($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,'full','ready',$6,$7,NOW(),$8::uuid,$9::jsonb,$10) ON CONFLICT DO NOTHING`,
        [asset.assetId,recording.recordingId,JSON.stringify(asset.candidate.metadata),JSON.stringify(asset.candidate.references ?? []),JSON.stringify(asset.locator),asset.mimeType,asset.sizeBytes,asset.ownerAccountId,
          JSON.stringify({ method: "exact-catalog-request-and-source-tag-validation", validatedAgainst: recording.references, validatedAt: new Date().toISOString(),...(asset.deliveryEvidence?{delivery:asset.deliveryEvidence}:{}) }),asset.sha256??null]);
      if(asset.sha256)await query(`UPDATE sakura_v2."AudioAsset" SET sha256=$3 WHERE recording_id=$1::uuid AND locator=$2::jsonb AND size_bytes=$4 AND owner_account_id IS NOT DISTINCT FROM $5::uuid`,[recording.recordingId,JSON.stringify(asset.locator),asset.sha256,asset.sizeBytes,asset.ownerAccountId]);
    });
  }
}
