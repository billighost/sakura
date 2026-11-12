import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getHome } from "@/rebuild/data/product";
export async function GET(request:Request){
  return withApiTiming("/api/v2/home", request, async () => {return productResponse(request,a=>getHome(a.id));
  });
}
