import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { listArtists } from "@/rebuild/data/product";
export async function GET(request:Request){
  return withApiTiming("/api/v2/artists", request, async () => {return productResponse(request,()=>listArtists());
  });
}
