import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { getHistory,recordHistory } from "@/rebuild/data/history";
export async function GET(request:Request){
  return withApiTiming("/api/v2/history", request, async () => {return productResponse(request,a=>getHistory(a.id,new URL(request.url)));
  });
}
export async function POST(request:Request){
  return withApiTiming("/api/v2/history", request, async () => {return productResponse(request,async a=>recordHistory(a.id,await jsonBody(request)));
  });
}
