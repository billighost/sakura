import { productResponse,jsonBody } from "@/rebuild/data/http";
import { revealBloom } from "@/rebuild/bloom/service";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return productResponse(request,async a=>revealBloom(a.id,id,(await jsonBody(request)).chapterId));}
