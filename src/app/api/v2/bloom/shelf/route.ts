import {productResponse} from "@/rebuild/data/http";
import {listBloomShelf} from "@/rebuild/bloom/service";
export async function GET(request:Request){return productResponse(request,account=>listBloomShelf(account.id));}
