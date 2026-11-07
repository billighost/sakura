import { productResponse,jsonBody } from "@/rebuild/data/http";
import { getPlaylist,updatePlaylist,deletePlaylist } from "@/rebuild/data/collections";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return productResponse(request,async a=>getPlaylist(a.id,(await context.params).id));}
export async function PATCH(request:Request,context:Context){return productResponse(request,async a=>updatePlaylist(a.id,(await context.params).id,await jsonBody(request)));}
export async function DELETE(request:Request,context:Context){return productResponse(request,async a=>deletePlaylist(a.id,(await context.params).id));}
