import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { listAlbums } from "@/rebuild/data/product";
export async function GET(request:Request){
  return withApiTiming("/api/v2/albums", request, async () => {return productResponse(request,()=>listAlbums());
  });
}
