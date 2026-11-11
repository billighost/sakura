/** Browser resources use their content identity, independent of query ordering. */
export function canonicalResourcePath(path:string){
 const [pathname,query]=path.split("?",2);
 if(!query)return pathname;
 const params=new URLSearchParams(query);params.sort();
 return pathname+"?"+params.toString();
}

/** Catalog identities stay valid until explicitly refreshed; personal feeds evolve. */
export function durableCatalogResource(path:string){
 const pathname=path.split("?",1)[0];
 return pathname==="/api/v2/search"||/^\/api\/v2\/(artists|albums)(\/[^/]+)?$/.test(pathname)||/^\/api\/v2\/recordings\/[^/]+$/.test(pathname)&&!pathname.endsWith("/resolve");
}

export function resourceIsFresh(path:string,updatedAt:number,now=Date.now()){
 const age=now-updatedAt;
 return Number.isFinite(updatedAt)&&updatedAt>0&&age>=-1000&&(durableCatalogResource(path)||age<120000);
}

export function browserOffline(){return typeof navigator!=="undefined"&&navigator.onLine===false;}
