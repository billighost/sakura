import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";

/** Boot needs verified account identity; profile analytics load with the profile. */
export async function GET(request: Request) {
  return withApiTiming("/api/v2/bootstrap", request, async () => {
  return productResponse(request, async account => ({ profile: account }));

  });
}
