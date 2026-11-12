import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse} from "@/rebuild/data/http";
import {getSearchSuggestions} from "@/rebuild/recommendations/searchSuggestions";
export async function GET(request:Request){
  return withApiTiming("/api/v2/search/suggestions", request, async () => {return productResponse(request,account=>getSearchSuggestions(account.id));
  });
}
