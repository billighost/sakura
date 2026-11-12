import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getMix } from "@/rebuild/recommendations/service";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  return withApiTiming("/api/v2/mixes/[id]", request, async () => {return productResponse(request,async a=>getMix(a.id,(await context.params).id));
  });
}
