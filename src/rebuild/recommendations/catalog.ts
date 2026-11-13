import { getRebuildServices } from "../server/runtime";
import { getRebuildPool } from "../data/db";
import { getSettings,refreshInitialTaste } from "../data/settings";
import type { ProviderReference } from "../core/types";
import type { ArtistSelection } from "../data/artistSelection";
import {catalogWork,type CatalogWorkPriority} from "../server/catalog-work";
import {ProviderFlight} from "../server/provider-flight";

const FIRST_RUN_ARTISTS=["Burna Boy","Wizkid","Bruno Mars","SZA","YOASOBI","Ado","Utada Hikaru","Kendrick Lamar","Billie Eilish","Tems","Daft Punk","The Weeknd","Rema","Fujii Kaze","Laufey","Nujabes","Radiohead","Khruangbin","Yussef Dayes"];
const runtime=globalThis as unknown as {sakuraCatalogWarmups?:Map<string,Promise<CatalogWarmup>>;sakuraFeedCatalogRefreshes?:Map<string,{at:number;signature:string}>};
interface CatalogWarmup {requested:number;indexed:number;failed:number;source:"online-catalog"}
const genreEnrichment=new ProviderFlight<{albums:number;enriched:number}>(1);
export function enrichCatalogGenres(signal?:AbortSignal,priority:CatalogWorkPriority="background"):Promise<{albums:number;enriched:number}>{
  return genreEnrichment.run("public-genres",signal,sharedSignal=>enrichGenres(sharedSignal,priority));
}
async function enrichGenres(signal:AbortSignal,priority:CatalogWorkPriority):Promise<{albums:number;enriched:number}> {
  const services=getRebuildServices(),pool=getRebuildPool();
  const rows=(await catalogWork(()=>pool.query(`SELECT DISTINCT a.id,a.external_id FROM sakura_v2."Album" a
    JOIN sakura_v2."RecordingAlbum" ra ON ra.album_id=a.id JOIN sakura_v2."Recording" r ON r.id=ra.recording_id
    WHERE a.provider='deezer' AND a.external_id ~ '^[1-9][0-9]{0,17}$' AND r.state='verified'
      AND COALESCE(jsonb_array_length(r.metadata->'genres'),0)=0 LIMIT 120`),priority,signal)).rows;
  let index=0,enriched=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{
    while(index<rows.length){
      if(signal?.aborted)break;
      const album=rows[index++];
      try{
        await catalogWork(async()=>{
        const detail=await services.catalog.detail("album",album.external_id,signal);signal.throwIfAborted();
        if(detail.genres.length){
          await pool.query(`UPDATE sakura_v2."Recording" r SET metadata=jsonb_set(r.metadata,'{genres}',$2::jsonb),
            provenance=r.provenance||jsonb_build_object('genres',jsonb_build_object('provider','deezer','albumId',$3::text,'verifiedAt',now()))
            FROM sakura_v2."RecordingAlbum" ra WHERE ra.recording_id=r.id AND ra.album_id=$1::uuid AND r.state='verified'`,
            [album.id,JSON.stringify(detail.genres),album.external_id]);enriched++;
        }
        await pool.query(`UPDATE sakura_v2."Album" SET release_date=COALESCE($2,release_date),provenance=provenance||$3::jsonb WHERE id=$1::uuid`,
          [album.id,detail.releaseDate||null,JSON.stringify({genres:detail.genres,provider:"deezer"})]);
        },priority,signal);
      }catch{/* Missing optional genre evidence leaves the recording untagged. */}
    }
  }));
  return {albums:rows.length,enriched};
}

/** Provider search acquires candidates; exact provider lookup owns identity.
 * A search snapshot is never promoted to a verified recording on its own. */
export async function seedCandidateCatalog(options:{artists?:string[];artistSelections?:readonly ArtistSelection[];perArtist?:number;includeCharts?:boolean;signal?:AbortSignal;priority?:CatalogWorkPriority}={}):Promise<CatalogWarmup> {
  const services=getRebuildServices(),exact=(options.artistSelections||[]).slice(0,20),normalizeName=(name:string)=>name.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en"),exactNames=new Set(exact.map(artist=>normalizeName(artist.name)));
  const artists=(options.artists?.length?options.artists.filter(name=>!exactNames.has(normalizeName(name))):exact.length?[]:FIRST_RUN_ARTISTS).slice(0,20-exact.length);
  const references=new Map<string,ProviderReference>();
  const sources=await Promise.allSettled([...artists.map(name=>catalogWork(()=>services.catalog.search(`artist:"${name.replaceAll('"','')}"`,options.signal),options.priority,options.signal)),
    ...exact.map(s=>catalogWork(()=>services.catalog.detail("artist",s.reference.provider==="spotify"?`spotify:${s.reference.id}`:s.reference.id,options.signal),options.priority,options.signal))]);
  for(const result of sources)if(result.status==="fulfilled")for(const track of result.value.tracks.slice(0,options.perArtist??6))references.set(`${track.reference.provider}:${track.reference.id}`,track.reference);
  if(options.includeCharts!==false){
    try{for(const track of (await catalogWork(()=>services.catalog.charts(options.signal),options.priority,options.signal)).tracks.slice(0,20))references.set(`${track.reference.provider}:${track.reference.id}`,track.reference);}catch{/* Existing artist candidates can still produce a varied first run. */}
  }
  let indexed=0,failed=0,index=0;
  const selected=[...references.values()];
  await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{
    while(index<selected.length){
      if(options.signal?.aborted)break;
      const reference=selected[index++];
      try{await catalogWork(()=>services.ingestor.ensureRecording(reference,undefined,options.signal),options.priority,options.signal);indexed++;}catch{failed++;}
    }
  }));
  if(!options.signal?.aborted)await enrichCatalogGenres(options.signal,options.priority);
  return {requested:selected.length,indexed,failed,source:"online-catalog"};
}

export async function warmCandidateCatalog(accountId:string,options:{priority?:CatalogWorkPriority}={}):Promise<CatalogWarmup> {
  const map=runtime.sakuraCatalogWarmups??=new Map();
  const active=map.get(accountId);if(active)return active;
  const operation=(async()=>{
    const priority=options.priority||"foreground",signal=AbortSignal.timeout(90000);
    const {settings,count}=await catalogWork(async()=>({settings:await getSettings(accountId),count:Number((await getRebuildPool().query(`SELECT COUNT(*) n FROM sakura_v2."Recording" WHERE state='verified'`)).rows[0].n)}),priority,signal);
    const artists=(settings.seedArtists as string[]).filter(a=>!/^\w{8}-[\w-]{27}$/.test(a));
    const artistSelections=settings.seedArtistSelections as ArtistSelection[];
    if(count>=80&&!artists.length)return {requested:0,indexed:0,failed:0,source:"online-catalog" as const};
    const result=await seedCandidateCatalog({artists:artists.length?artists:undefined,artistSelections,perArtist:8,includeCharts:count<80,signal,priority});
    await catalogWork(()=>refreshInitialTaste(accountId),priority,signal);return result;
  })().finally(()=>map.delete(accountId));
  map.set(accountId,operation);return operation;
}

/** Refresh verified candidates after the first feed response, with bounded work.
 * A new snapshot can then include the new cards without changing a scroll session. */
export async function refreshFeedCatalog(accountId:string,settingsSnapshot?:Awaited<ReturnType<typeof getSettings>>):Promise<void>{
  const settings=settingsSnapshot||await catalogWork(()=>getSettings(accountId)),checks=runtime.sakuraFeedCatalogRefreshes??=new Map();
  const signature=JSON.stringify([settings.seedArtists,settings.seedGenres,settings.seedArtistSelections,settings.learnFromListening]);
  const previous=checks.get(accountId),now=Date.now();
  if(previous?.signature===signature&&now-previous.at<6*60*60*1000)return;
  const check={at:now,signature};checks.delete(accountId);checks.set(accountId,check);while(checks.size>512)checks.delete(checks.keys().next().value!);
  try{
    const signal=AbortSignal.timeout(85000);
    const rows=(await catalogWork(()=>getRebuildPool().query(`SELECT a.provider,a.external_id AS "externalId",a.name,SUM(source.weight) AS affinity
      FROM (SELECT recording_id,LEAST(12,audible_ms::numeric/60000) AS weight FROM sakura_v2."ListeningRecordingSummary"
        WHERE account_id=$1::uuid AND $2::boolean AND audible_ms>0
        UNION ALL SELECT recording_id,12 AS weight FROM sakura_v2."Favorite" WHERE account_id=$1::uuid) source
      JOIN sakura_v2."RecordingArtist" ra ON ra.recording_id=source.recording_id AND ra.position=0
      JOIN sakura_v2."Artist" a ON a.id=ra.artist_id
      WHERE NOT EXISTS(SELECT 1 FROM sakura_v2."TasteFeedback" f WHERE f.account_id=$1::uuid
        AND f.kind IN ('block','snooze') AND (f.expires_at IS NULL OR f.expires_at>now())
        AND ((f.target='recording' AND f.target_id=source.recording_id) OR (f.target='artist' AND f.target_id=a.id)))
      GROUP BY a.id ORDER BY SUM(source.weight) DESC,a.id LIMIT 12`,[accountId,settings.learnFromListening!==false]),"background",signal)).rows;
    const exact=(settings.seedArtistSelections as ArtistSelection[]).slice();
    for(const row of rows)if((row.provider==="deezer"&&/^[1-9]\d{0,17}$/.test(row.externalId))||(row.provider==="spotify"&&/^[A-Za-z0-9]{22}$/.test(row.externalId))){
      const selection={name:row.name,reference:{provider:row.provider,id:row.externalId} as ProviderReference,selectionKey:`artist:${row.provider}:${row.externalId}`};
      if(!exact.some(item=>item.selectionKey===selection.selectionKey))exact.push(selection);
    }
    await seedCandidateCatalog({artistSelections:exact.slice(0,16),artists:settings.seedArtists as string[],perArtist:12,includeCharts:true,signal});
    // A rotating catalog entry point keeps new voices present beside known artists.
    if(!signal.aborted){const rotation=Math.floor(now/(6*60*60*1000))%FIRST_RUN_ARTISTS.length;
      const artists=Array.from({length:4},(_,index)=>FIRST_RUN_ARTISTS[(rotation+index*5)%FIRST_RUN_ARTISTS.length]);
      await seedCandidateCatalog({artists,perArtist:5,includeCharts:false,signal});}
    await catalogWork(()=>refreshInitialTaste(accountId),"background",signal);
  }catch(error){if(checks.get(accountId)===check)checks.delete(accountId);throw error;}
}
