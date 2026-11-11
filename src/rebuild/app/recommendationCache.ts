import {localRead,localWrite} from "./offline";

export interface RecommendationCache<T>{data:T;savedAt:number}
const invalidationKey=(accountId:string)=>"sakura-v2-recommendations-cleared:"+accountId;
export function recommendationCacheVersion(accountId:string){
 try{return Math.max(Number(localStorage.getItem(invalidationKey(accountId)))||0,Number(localStorage.getItem("sakura-v2-listening-resource-erased:"+accountId))||0);}catch{return 0;}
}
export function recommendationCacheValid(accountId:string,savedAt:number){return Number.isFinite(savedAt)&&savedAt>recommendationCacheVersion(accountId);}
export function clearRecommendationCache(accountId:string){
 const stamp=Math.max(Date.now(),recommendationCacheVersion(accountId)+1);
 try{localStorage.setItem(invalidationKey(accountId),String(stamp));}catch{}
}
export async function readRecommendationCache<T>(accountId:string,key:string):Promise<RecommendationCache<T>|undefined>{
 const saved=await localRead<RecommendationCache<T>>(accountId,"recommendation-view:"+key).catch(()=>undefined);
 return saved&&recommendationCacheValid(accountId,saved.savedAt)?saved:undefined;
}
/** A late response from before erasure must never recreate a private explanation. */
export async function writeRecommendationCache<T>(accountId:string,key:string,data:T,version:number){
 if(recommendationCacheVersion(accountId)!==version)return;
 const savedAt=Math.max(Date.now(),version+1);
 await localWrite(accountId,"recommendation-view:"+key,{data,savedAt}).catch(()=>{});
}

if(typeof window!=="undefined")window.addEventListener("storage",event=>{
 const prefix="sakura-v2-recommendations-cleared:";
 if(event.key?.startsWith(prefix))window.dispatchEvent(new CustomEvent("sakura-recommendations-cleared",{detail:{accountId:event.key.slice(prefix.length)}}));
});
