import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse,jsonBody} from "@/rebuild/data/http";
import {generateSmartQueue} from "@/rebuild/recommendations/feed";
export async function POST(request:Request){
  return withApiTiming("/api/v2/smart-queue", request, async () => {return productResponse(request,async account=>generateSmartQueue(account.id,await jsonBody(request)));
  });
}
