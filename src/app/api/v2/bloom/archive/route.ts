import { productResponse } from "@/rebuild/data/http";
import { archivedBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request){return productResponse(request,a=>archivedBloom(a.id,new URL(request.url).searchParams.get("year")));}
