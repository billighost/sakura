import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse,jsonBody } from "@/rebuild/data/http";
import { mutatePlaylistTracks } from "@/rebuild/data/collections";
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,context:Context){
  return withApiTiming("/api/v2/playlists/[id]/tracks", request, async () => {return productResponse(request,async a=>mutatePlaylistTracks(a.id,(await context.params).id,await jsonBody(request)));
  });
}
export async function DELETE(request:Request,context:Context){
  return withApiTiming("/api/v2/playlists/[id]/tracks", request, async () => {return productResponse(request,async a=>mutatePlaylistTracks(a.id,(await context.params).id,await jsonBody(request),true));
  });
}
