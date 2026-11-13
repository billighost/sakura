import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody,compactProductRequest } from "@/rebuild/data/http";
import { getProfile,patchProfile,patchProfileReceipt } from "@/rebuild/data/product";
export async function GET(request:Request){
  return withApiTiming("/api/v2/profile", request, async () => {return productResponse(request,a=>getProfile(a.id));
  });
}
export async function PATCH(request:Request){
  return withApiTiming("/api/v2/profile", request, async () => {return productResponse(request,async a=>(compactProductRequest(request)?patchProfileReceipt:patchProfile)(a.id,await jsonBody(request)));
  });
}
