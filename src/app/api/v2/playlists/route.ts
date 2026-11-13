import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody,compactProductRequest } from "@/rebuild/data/http";
import { listPlaylists,createPlaylist,createPlaylistReceipt } from "@/rebuild/data/collections";
export async function GET(request:Request){
  return withApiTiming("/api/v2/playlists", request, async () => {return productResponse(request,async a=>({playlists:await listPlaylists(a.id)}));
  });
}
export async function POST(request:Request){
  return withApiTiming("/api/v2/playlists", request, async () => {return productResponse(request,async a=>(compactProductRequest(request)?createPlaylistReceipt:createPlaylist)(a.id,await jsonBody(request)));
  });
}
