import {productResponse,jsonBody} from "@/rebuild/data/http";
import {generateSmartQueue} from "@/rebuild/recommendations/feed";
export async function POST(request:Request){return productResponse(request,async account=>generateSmartQueue(account.id,await jsonBody(request)));}
