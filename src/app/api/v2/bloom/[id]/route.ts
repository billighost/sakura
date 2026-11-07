import { productResponse } from "@/rebuild/data/http";
import { getBloom } from "@/rebuild/bloom/service";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return productResponse(request,a=>getBloom(a.id,id));}
