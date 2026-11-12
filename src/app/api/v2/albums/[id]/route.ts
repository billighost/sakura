import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getAlbum } from "@/rebuild/data/product";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  return withApiTiming("/api/v2/albums/[id]", request, async () => {return productResponse(request,async a=>getAlbum(a.id,(await context.params).id));
  });
}
