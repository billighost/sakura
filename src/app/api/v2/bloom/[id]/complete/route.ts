import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { completeBloom } from "@/rebuild/bloom/service";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  return withApiTiming("/api/v2/bloom/[id]/complete", request, async () => {const {id}=await context.params;return productResponse(request,a=>completeBloom(a.id,id));
  });
}
