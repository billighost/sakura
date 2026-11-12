import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse} from "@/rebuild/data/http";
import {getPersonalizedFeed} from "@/rebuild/recommendations/feed";
import {refreshFeedCatalog} from "@/rebuild/recommendations/catalog";
import {after} from "next/server";
export const maxDuration=120;
export async function GET(request:Request){
  return withApiTiming("/api/v2/feed", request, async () => {
  return productResponse(request,async account=>{
    const url=new URL(request.url),page=await getPersonalizedFeed(account.id,url);
    if(!url.searchParams.get("cursor"))after(async()=>{await refreshFeedCatalog(account.id).catch(error=>console.error("[Sakura feed] Catalog refresh unavailable",error instanceof Error?error.name:"UnknownError"));});
    return page;
  });

  });
}
