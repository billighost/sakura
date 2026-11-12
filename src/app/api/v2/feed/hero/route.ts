import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse} from "@/rebuild/data/http";
import {getPersonalizedHero} from "@/rebuild/recommendations/feed";

export async function GET(request:Request){
  return withApiTiming("/api/v2/feed/hero", request, async () => {
 return productResponse(request,account=>getPersonalizedHero(account.id,new URL(request.url)));

  });
}
