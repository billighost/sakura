/** Next dev can use a bind address in request.url; browsers use the public Host. */
export function sameRequestOrigin(request:Request):boolean{
 const origin=request.headers.get("origin");if(!origin)return true;
 try{
  const candidate=new URL(origin);if(candidate.origin!==origin)return false;
  const url=new URL(request.url);if(origin===url.origin)return true;
  const host=request.headers.get("host");if(!host||host.includes(",")||host.includes("/")||host.includes("@"))return false;
  const forwarded=request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol=forwarded==="https"||forwarded==="http"?forwarded+":":url.protocol;
  return candidate.protocol===protocol&&candidate.host===host;
 }catch{return false;}
}
