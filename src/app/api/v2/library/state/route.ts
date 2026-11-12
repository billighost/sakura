import { withApiTiming } from "@/rebuild/server/performance";
import { productResponse } from "@/rebuild/data/http";
import { getFavoriteStates } from "@/rebuild/data/collections";

/** One snapshot includes unlike tombstones as well as currently liked songs. */
export async function GET(request: Request) {
  return withApiTiming("/api/v2/library/state", request, async () => {
  return productResponse(request, async account => ({ favoriteStates: await getFavoriteStates(account.id) }));

  });
}
