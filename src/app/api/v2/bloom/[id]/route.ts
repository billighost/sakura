import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getBloom,prepareBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  return withApiTiming("/api/v2/bloom/[id]", request, async () => {const {id}=await context.params;return productResponse(request,a=>new URL(request.url).searchParams.get("prepare")==="1"?prepareBloom(a.id,id,new Date(),{includeEmpty:true}):getBloom(a.id,id));
  });
}
