import { verifiedRecordingAliases } from "../core/matching";
import { referenceKey } from "../core/identity";
import type { CanonicalRecording, RecordingRequest, RecordingMetadata, VerifiedRecordingAlias } from "../core/types";
import type { CatalogProvider, CatalogRecording } from "./contracts";
import { parseRecordingMetadata } from "./input";
import { CatalogArtistAliases } from "./artist-aliases";

function aliasKey(alias:VerifiedRecordingAlias):string{
 const metadata=alias.metadata;
 return JSON.stringify([metadata.title,metadata.artists,metadata.artistsComplete,metadata.durationMs??null,metadata.explicit??"unknown",metadata.version?[metadata.version.kinds,metadata.version.labels]:null,alias.references.map(referenceKey).sort()]);
}

/** Whole exact catalogue rows establish alternate writing. Album titles, fuzzy
 * search results and guessed transliterations never enter this proof layer. */
export function withVerifiedCatalogAliases(request: RecordingRequest, candidates: readonly CatalogRecording[]): RecordingMetadata {
 const proposed:VerifiedRecordingAlias[]=[...verifiedRecordingAliases(request)];
 for(const candidate of candidates){
  const metadata=parseRecordingMetadata(candidate.metadata);
  if(metadata.artistsComplete!==true)continue;
  const alias={metadata,references:candidate.references};
  proposed.push(...verifiedRecordingAliases({...request,metadata:{...request.metadata,verifiedAliases:[alias]}}));
 }
 const unique=new Map(proposed.map(alias=>[aliasKey(alias),alias]));
 const aliases=[...unique.values()].slice(0,16);
 const previous=Array.isArray(request.metadata.verifiedAliases)?request.metadata.verifiedAliases:[];
 const previousKeys=previous.map(alias=>{try{return aliasKey(alias);}catch{return "invalid-proof";}});
 if(JSON.stringify(aliases.map(aliasKey).sort())===JSON.stringify(previousKeys.sort()))return request.metadata;
 return aliases.length?{...request.metadata,verifiedAliases:aliases}:request.metadata;
}

/** Re-query exact ISRC aliases from either provider, including alternate releases
 * on the selected provider. HOKO's localized single and album IDs are one such
 * general case; no song or artist names are configured here. */
export class CatalogMetadataAliases {
 private cached=new Map<string,{aliases:readonly CatalogRecording[];until:number}>();
 constructor(private readonly providers:readonly CatalogProvider[],private readonly artistAliases=new CatalogArtistAliases()){}
 async hydrate(recording:CanonicalRecording,signal?:AbortSignal):Promise<CanonicalRecording>{
  signal?.throwIfAborted();
  const authoritative=recording.references?.find(ref=>ref.provider==="isrc");
  if(!authoritative||!this.providers.length)return recording;
  const key=recording.recordingId+":"+referenceKey(authoritative),cached=this.cached.get(key);
  let candidates:readonly CatalogRecording[];
  if(cached&&cached.until>Date.now())candidates=cached.aliases;
  else{
   const lookupSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
   const results=await Promise.allSettled(this.providers.filter(provider=>provider.getByIsrc).map(provider=>provider.getByIsrc!(authoritative.id,lookupSignal)));
   signal?.throwIfAborted();
   candidates=results.flatMap(result=>result.status==="fulfilled"?result.value:[]).filter(candidate=>candidate.references.some(ref=>referenceKey(ref)===referenceKey(authoritative)));
   // Only successful public metadata is cached. A transport failure cannot
   // suppress future native-title recovery.
   if(candidates.length){if(this.cached.size>=1000)this.cached.delete(this.cached.keys().next().value!);this.cached.set(key,{aliases:candidates,until:Date.now()+15*60000});}
  }
  // Join exact recording-title proof to independently verified artist-name
  // proof. Keep the caches separate so a temporary artist lookup failure can
  // be retried even when the complete catalogue row is already cached.
  const enriched:CatalogRecording[]=[...candidates];
  const aliasSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
  for(const candidate of candidates.slice(0,8)){
   if(!verifiedRecordingAliases({...recording,metadata:{...recording.metadata,verifiedAliases:[{metadata:candidate.metadata,references:candidate.references}]}}).length)continue;
   try{enriched.push(...await this.artistAliases.variants(candidate,aliasSignal));}
   catch{signal?.throwIfAborted();break;}
  }
  const metadata=withVerifiedCatalogAliases(recording,enriched);
  signal?.throwIfAborted();
  return metadata===recording.metadata?recording:{...recording,metadata};
 }
}
