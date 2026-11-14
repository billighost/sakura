import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse} from "@/rebuild/data/http";
import {getPersonalizedFeed,personalizedFeedSettings} from "@/rebuild/recommendations/feed";
import {refreshFeedCatalog,feedCatalogRefreshStatus} from "@/rebuild/recommendations/catalog";
import {after} from "next/server";
import {getSettingsSnapshot} from "@/rebuild/data/settings";
import {getRebuildPool} from "@/rebuild/data/db";
export const maxDuration=120;
export async function GET(request:Request){
  return withApiTiming("/api/v2/feed", request, async () => {
  return productResponse(request,async account=>{
    const url=new URL(request.url);
    if(url.searchParams.get("catalogRefreshStatus")==="1"){
      const settings=await getSettingsSnapshot(account.id,getRebuildPool());
      const catalogRefresh=await feedCatalogRefreshStatus(account.id,settings);
      if(request.method!=="HEAD"&&catalogRefresh.pending&&catalogRefresh.retryAfterMs<=2000)after(async()=>{await refreshFeedCatalog(account.id,settings).catch(error=>console.error("[Sakura feed] Catalog refresh unavailable",error instanceof Error?error.name:"UnknownError"));});
      return {catalogRefresh};
    }
    const page=await getPersonalizedFeed(account.id,url);
    const settings=personalizedFeedSettings(page);
    if(request.method!=="HEAD"&&!url.searchParams.get("cursor")&&settings){
      const catalogRefresh=await feedCatalogRefreshStatus(account.id,settings);
      if(catalogRefresh.pending)after(async()=>{await refreshFeedCatalog(account.id,settings).catch(error=>console.error("[Sakura feed] Catalog refresh unavailable",error instanceof Error?error.name:"UnknownError"));});
      return {...page,catalogRefresh};
    }
    return page;
  });

  });
}
