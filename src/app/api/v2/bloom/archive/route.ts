import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { archivedBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request){
  return withApiTiming("/api/v2/bloom/archive", request, async () => {return productResponse(request,a=>archivedBloom(a.id,new URL(request.url).searchParams.get("year")));
  });
}
