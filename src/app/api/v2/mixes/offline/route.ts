import { productResponse,jsonBody } from "@/rebuild/data/http";
import { offlineMixes } from "@/rebuild/recommendations/service";
export async function POST(request:Request){return productResponse(request,async a=>offlineMixes(a.id,await jsonBody(request)));}
