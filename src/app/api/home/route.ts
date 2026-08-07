import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHomeData } from "@/lib/homeData";

/**
 * `getHomeData` owns everything: the Redis cache, the chart-freshness check,
 * and scheduling the daily refresh via `after()`.
 *
 * This route used to *also* run its own freshness check and kick off the same
 * five `updateSystemPlaylist` calls from a `setTimeout`. That meant every
 * uncached home request did the chart work twice — and the copy here used the
 * pattern AUDIT #17 replaced precisely because a timer started during a server
 * render isn't guaranteed to survive the response on a serverless host.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getHomeData(session.user.id!);

  return NextResponse.json(result, {
    headers: {
      // Per-user content: safe in the browser's own cache, never in a shared
      // one. `stale-while-revalidate` lets a back-navigation paint instantly
      // while the refresh happens behind it.
      "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
    },
  });
}
