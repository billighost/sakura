import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { offlineMixes } from "@/rebuild/recommendations/service";
export async function POST(request:Request){
  return withApiTiming("/api/v2/mixes/offline", request, async () => {return productResponse(request,async a=>offlineMixes(a.id,await jsonBody(request)));
  });
}
