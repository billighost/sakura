import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { revealBloom } from "@/rebuild/bloom/service";
import { bloomDisclosureReply } from "@/rebuild/bloom/receipts";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  return withApiTiming("/api/v2/bloom/[id]/reveal", request, async () => {const {id}=await context.params;return productResponse(request,async a=>{const body=await jsonBody(request);return bloomDisclosureReply(await revealBloom(a.id,id,body.chapterId),body.scope);});
  });
}
