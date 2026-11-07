import { productResponse,jsonBody } from "@/rebuild/data/http";
import { mutatePlaylistTracks } from "@/rebuild/data/collections";
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,context:Context){return productResponse(request,async a=>mutatePlaylistTracks(a.id,(await context.params).id,await jsonBody(request)));}
export async function DELETE(request:Request,context:Context){return productResponse(request,async a=>mutatePlaylistTracks(a.id,(await context.params).id,await jsonBody(request),true));}
