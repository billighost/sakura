import { withApiTiming } from "@/rebuild/server/performance";
import {productResponse,jsonBody} from "@/rebuild/data/http";
import {previewInitialTaste} from "@/rebuild/data/initialTaste";

export async function POST(request:Request){
  return withApiTiming("/api/v2/onboarding/preview", request, async () => {return productResponse(request,async account=>previewInitialTaste(account.id,await jsonBody(request)));
  });
}
