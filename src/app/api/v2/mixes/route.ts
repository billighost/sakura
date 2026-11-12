import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { ensureMixes } from "@/rebuild/recommendations/service";
import { warmCandidateCatalog } from "@/rebuild/recommendations/catalog";
export const maxDuration=120;
export async function GET(request:Request){
  return withApiTiming("/api/v2/mixes", request, async () => {return productResponse(request,async a=>({mixes:await ensureMixes(a.id)}));
  });
}
export async function POST(request:Request){
  return withApiTiming("/api/v2/mixes", request, async () => {return productResponse(request,async a=>{const catalog=await warmCandidateCatalog(a.id);return {mixes:await ensureMixes(a.id,true),catalog};});
  });
}
