import { withApiTiming } from "@/rebuild/server/performance";
import { jsonBody, productResponse,compactProductRequest } from "@/rebuild/data/http";
import { clearPersonalizationData, exportPersonalizationData } from "@/rebuild/data/personalization";
import {streamPersonalizationData} from "@/rebuild/data/personalizationExport";
export const maxDuration=300;
export async function GET(request:Request){
  return withApiTiming("/api/v2/personalization/data", request, async () => {return productResponse(request,account=>compactProductRequest(request)?streamPersonalizationData(account.id,request.signal):exportPersonalizationData(account.id));
  });
}
// Next automatically calls GET for HEAD. Opening an export snapshot for a body
// the adapter will discard would retain its connection until timeout.
export async function HEAD(request:Request){
  return withApiTiming("/api/v2/personalization/data",request,()=>productResponse(request,async()=>new Response(null,{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="sakura-my-listening-data-${new Date().toISOString().slice(0,10)}.json"`}})));
}
export async function DELETE(request:Request){
  return withApiTiming("/api/v2/personalization/data", request, async () => {return productResponse(request,async account=>clearPersonalizationData(account.id,await jsonBody(request)));
  });
}
