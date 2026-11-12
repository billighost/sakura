import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse} from "@/rebuild/data/http";
import {listBloomShelf} from "@/rebuild/bloom/service";
export async function GET(request:Request){
  return withApiTiming("/api/v2/bloom/shelf", request, async () => {return productResponse(request,account=>listBloomShelf(account.id));
  });
}
