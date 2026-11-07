import { productResponse } from "@/rebuild/data/http";
import { listBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request){return productResponse(request,a=>listBloom(a.id,new URL(request.url).searchParams.get("period")));}
