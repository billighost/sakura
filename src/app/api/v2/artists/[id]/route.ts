import { productResponse } from "@/rebuild/data/http";
import { getArtist } from "@/rebuild/data/product";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return productResponse(request,async a=>getArtist(a.id,(await context.params).id));}
