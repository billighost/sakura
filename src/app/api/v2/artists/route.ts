import { productResponse } from "@/rebuild/data/http";
import { listArtists } from "@/rebuild/data/product";
export async function GET(request:Request){return productResponse(request,()=>listArtists());}
