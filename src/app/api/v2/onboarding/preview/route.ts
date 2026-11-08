import {productResponse,jsonBody} from "@/rebuild/data/http";
import {previewInitialTaste} from "@/rebuild/data/initialTaste";

export async function POST(request:Request){return productResponse(request,async account=>previewInitialTaste(account.id,await jsonBody(request)));}
