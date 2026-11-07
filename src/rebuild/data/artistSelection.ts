import type { ProviderReference } from "../core/types";
export interface ArtistSelection {name:string;reference:ProviderReference;selectionKey:string}
type ArtistChoice={id:string;name:string;reference?:ProviderReference;provider?:string;externalId?:string;imageUrl?:string|null;trackCount?:number;albumCount?:number;albumsCount?:number};
const key=(name:string)=>name.normalize("NFKC").trim().toLocaleLowerCase("en");
function reference(row:ArtistChoice):ProviderReference|null {
  if(row.reference)return row.reference;
  if(row.provider&&row.externalId)return {provider:row.provider as ProviderReference["provider"],id:row.externalId};
  if(/^spotify:[A-Za-z0-9]{22}$/.test(row.id))return {provider:"spotify",id:row.id.slice(8)};
  if(/^\d+$/.test(row.id))return {provider:"deezer",id:row.id};
  return null;
}
/** Display grouping only. Provider identities are retained; equal artist names
 * never authorize a database identity merge or recording alias. */
export function groupArtistCards<T extends ArtistChoice>(rows:readonly T[]) {
  const groups=new Map<string,T[]>();
  for(const row of rows){if(!row.name.trim())continue;const normalized=key(row.name);groups.set(normalized,[...(groups.get(normalized)||[]),row]);}
  const score=(row:T)=>(row.trackCount||0)*10000+(row.albumCount||row.albumsCount||0)*100+(row.imageUrl?1:0);
  return [...groups.values()].map(group=>{
    group.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
    const primary=group[0],ref=reference(primary);
    const alternatives=[...new Map(group.flatMap(row=>{const r=reference(row);return r?[[`${r.provider}:${r.id}`,r] as const]:[];})).values()];
    return {...primary,selectionKey:ref?`artist:${ref.provider}:${ref.id}`:`artist:${primary.id}`,...(ref?{reference:ref}:{}),alternativeReferences:alternatives};
  });
}
