import { productResponse } from "@/rebuild/data/http";
import { listAlbums } from "@/rebuild/data/product";
export async function GET(request:Request){return productResponse(request,()=>listAlbums());}
