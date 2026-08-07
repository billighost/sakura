import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Import all possible GET handlers we want to support in batch
import { GET as getHistory } from "@/app/api/history/route";
import { GET as getTracks } from "@/app/api/tracks/route";
import { GET as getArtists } from "@/app/api/artists/route";
import { GET as getProfile } from "@/app/api/profile/route";
import { GET as getPlaylists } from "@/app/api/playlists/route";
import { GET as getCharts } from "@/app/api/charts/route";
import { GET as getAlbums } from "@/app/api/albums/route";

/**
 * Batch several GET requests into one round trip.
 *
 * Handlers are invoked in-process with a reconstructed NextRequest rather than
 * re-fetched over HTTP — the point of this endpoint is removing round trips,
 * so making N internal ones would defeat it.
 *
 * Constraints this relies on, worth keeping in mind before adding a route to
 * the table below:
 *   • Only non-dynamic routes. Handlers here are called with a single
 *     argument, so anything reading route `params` will not work.
 *   • Only GETs with no side effects — the whole array runs concurrently and
 *     partial failure is normal.
 *   • Handlers must derive everything from the URL and headers, both of which
 *     are forwarded intact.
 */
const routes: Record<string, (req: NextRequest) => Promise<Response>> = {
  "/api/history": getHistory,
  "/api/tracks": getTracks,
  "/api/artists": getArtists,
  "/api/profile": getProfile,
  "/api/playlists": getPlaylists,
  "/api/charts": getCharts,
  "/api/albums": getAlbums,
};

/** Bounded so one request can't fan out into unlimited server work. */
const MAX_BATCH_SIZE = 12;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requests = body?.requests;
  if (!Array.isArray(requests)) {
    return NextResponse.json({ error: "Invalid requests array" }, { status: 400 });
  }
  if (requests.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Too many requests in one batch (max ${MAX_BATCH_SIZE})` },
      { status: 400 }
    );
  }

  const baseUrl = new URL(req.url).origin;
  const results: Record<string, { status: number; data: any }> = {};

  // De-duplicate by key: a repeated key would otherwise have both results race
  // to write the same slot, making the winner nondeterministic.
  const seenKeys = new Set<string>();
  const unique = requests.filter((r: any) => {
    if (!r || typeof r.key !== "string" || typeof r.path !== "string") return false;
    if (seenKeys.has(r.key)) return false;
    seenKeys.add(r.key);
    return true;
  });

  await Promise.allSettled(
    unique.map(async (r: { key: string; path: string }) => {
      try {
        // Resolving against the origin also normalises traversal attempts
        // ("/api/../admin") before the allowlist check below sees them.
        const url = new URL(r.path, baseUrl);
        if (url.origin !== baseUrl) {
          results[r.key] = { status: 400, data: { error: "Cross-origin path rejected" } };
          return;
        }

        const handler = routes[url.pathname];
        if (!handler) {
          results[r.key] = { status: 404, data: { error: "Route not supported in batch" } };
          return;
        }

        // Forward the original headers so the nested auth() call resolves the
        // same session. Query params ride along in the URL.
        const subReq = new NextRequest(url.toString(), {
          method: "GET",
          headers: req.headers,
        });

        const res = await handler(subReq);
        const data = await res.json().catch(() => null);
        results[r.key] = { status: res.status, data };
      } catch (err) {
        console.error(`Batch request failed for ${r.path}:`, err);
        results[r.key] = { status: 500, data: { error: "Internal error" } };
      }
    })
  );

  return NextResponse.json({ results });
}
