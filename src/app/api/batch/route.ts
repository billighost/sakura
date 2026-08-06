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

const routes: Record<string, Function> = {
  "/api/history": getHistory,
  "/api/tracks": getTracks,
  "/api/artists": getArtists,
  "/api/profile": getProfile,
  "/api/playlists": getPlaylists,
  "/api/charts": getCharts,
  "/api/albums": getAlbums,
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requests } = await req.json();
  if (!Array.isArray(requests)) {
    return NextResponse.json({ error: "Invalid requests array" }, { status: 400 });
  }

  const baseUrl = new URL(req.url).origin;
  
  const results: Record<string, { status: number; data: any }> = {};

  // Run all batch requests in parallel
  await Promise.allSettled(
    requests.map(async (r: { key: string; path: string }) => {
      try {
        const url = new URL(r.path, baseUrl);
        const pathBase = url.pathname;
        const handler = routes[pathBase];

        if (!handler) {
          results[r.key] = { status: 404, data: { error: "Route not supported in batch" } };
          return;
        }

        // Construct a mock NextRequest for the sub-handler.
        // It's important to pass cookies so the auth() call inside the handler works
        // (even though they share the same session, auth() reads from headers/cookies).
        const subReq = new NextRequest(url.toString(), {
          method: "GET",
          headers: req.headers,
        });

        const res: NextResponse = await handler(subReq, { params: Promise.resolve({}) });
        const data = await res.json();
        results[r.key] = { status: res.status, data };
      } catch (err) {
        console.error(`Batch request failed for ${r.path}:`, err);
        results[r.key] = { status: 500, data: { error: "Internal error" } };
      }
    })
  );

  return NextResponse.json({ results });
}
