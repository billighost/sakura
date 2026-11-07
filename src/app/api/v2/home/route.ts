import { productResponse } from "@/rebuild/data/http";
import { getHome } from "@/rebuild/data/product";
export async function GET(request:Request){return productResponse(request,a=>getHome(a.id));}
