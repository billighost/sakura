import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { listBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request){
  return withApiTiming("/api/v2/bloom", request, async () => {return productResponse(request,a=>listBloom(a.id,new URL(request.url).searchParams.get("period")));
  });
}
