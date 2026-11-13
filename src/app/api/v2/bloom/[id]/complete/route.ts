import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { completeBloom } from "@/rebuild/bloom/service";
import { bloomDisclosureReply } from "@/rebuild/bloom/receipts";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  return withApiTiming("/api/v2/bloom/[id]/complete", request, async () => {const {id}=await context.params;return productResponse(request,async a=>{const body=request.headers.get("Content-Type")?.includes("application/json")?await jsonBody(request):{};return bloomDisclosureReply(await completeBloom(a.id,id),body.scope);});
  });
}
