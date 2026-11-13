import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody,compactProductRequest } from "@/rebuild/data/http";
import { getPlaylist,updatePlaylist,updatePlaylistReceipt,deletePlaylist } from "@/rebuild/data/collections";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  return withApiTiming("/api/v2/playlists/[id]", request, async () => {return productResponse(request,async a=>getPlaylist(a.id,(await context.params).id));
  });
}
export async function PATCH(request:Request,context:Context){
  return withApiTiming("/api/v2/playlists/[id]", request, async () => {return productResponse(request,async a=>(compactProductRequest(request)?updatePlaylistReceipt:updatePlaylist)(a.id,(await context.params).id,await jsonBody(request)));
  });
}
export async function DELETE(request:Request,context:Context){
  return withApiTiming("/api/v2/playlists/[id]", request, async () => {return productResponse(request,async a=>deletePlaylist(a.id,(await context.params).id));
  });
}
