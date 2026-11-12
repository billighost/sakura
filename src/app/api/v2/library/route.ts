import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { getLibrary,setFavorite } from "@/rebuild/data/collections";
export async function GET(request:Request){
  return withApiTiming("/api/v2/library", request, async () => {return productResponse(request,a=>getLibrary(a.id,new URL(request.url)));
  });
}
export async function POST(request:Request){
  return withApiTiming("/api/v2/library", request, async () => {return productResponse(request,async a=>setFavorite(a.id,await jsonBody(request)));
  });
}
export async function DELETE(request:Request){
  return withApiTiming("/api/v2/library", request, async () => {return productResponse(request,async a=>setFavorite(a.id,{...await jsonBody(request),liked:false}));
  });
}
