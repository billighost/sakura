const MAX_ARTWORK_URL_LENGTH=2000;

function safeArtworkUrl(value:unknown) {
 if(typeof value!=="string")return null;
 const trimmed=value.trim();
 if(!trimmed||trimmed.length>MAX_ARTWORK_URL_LENGTH)return null;
 try{
  const url=new URL(trimmed);
  if(url.protocol!=="http:"&&url.protocol!=="https:")return null;
  url.hash="";
  return url.toString();
 }catch{return null;}
}

/** Keep a playlist collage stable, compact, and free of repeated album art. */
export function playlistArtworkSources(primary:unknown,candidates:unknown,limit=4) {
 const maximum=Math.max(1,Math.min(4,Math.floor(limit)||4));
 const values=[primary,...(Array.isArray(candidates)?candidates:[])],seen=new Set<string>(),sources:string[]=[];
 for(const value of values){
  const source=safeArtworkUrl(value);
  if(!source||seen.has(source))continue;
  seen.add(source);sources.push(source);
  if(sources.length===maximum)break;
 }
 return sources;
}
