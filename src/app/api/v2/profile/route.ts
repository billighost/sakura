import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { getProfile,patchProfile } from "@/rebuild/data/product";
export async function GET(request:Request){
  return withApiTiming("/api/v2/profile", request, async () => {return productResponse(request,a=>getProfile(a.id));
  });
}
export async function PATCH(request:Request){
  return withApiTiming("/api/v2/profile", request, async () => {return productResponse(request,async a=>patchProfile(a.id,await jsonBody(request)));
  });
}
