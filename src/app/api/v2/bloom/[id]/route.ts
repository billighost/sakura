import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  return withApiTiming("/api/v2/bloom/[id]", request, async () => {const {id}=await context.params;return productResponse(request,a=>getBloom(a.id,id));
  });
}
