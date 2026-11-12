import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { ArtworkDeliveryError, deliverArtwork } from "@/rebuild/player/artworkDelivery";

export async function GET(request: NextRequest) {
  return withApiTiming("/api/v2/image", request, async () => {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw || raw.length > 3000) return NextResponse.json({ error: "An artwork URL is required" }, { status: 400 });
  try {
    const { bytes, type, etag } = await deliverArtwork(raw);
    const cacheControl = "public, max-age=604800, stale-while-revalidate=2592000, stale-if-error=2592000";
    const cacheHeaders = { ETag: etag, "Cache-Control": cacheControl, "CDN-Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" };
    if (request.headers.get("If-None-Match") === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });
    return new NextResponse(bytes, { headers: { ...cacheHeaders, "Content-Type": type, "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) {
    if (error instanceof ArtworkDeliveryError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error && error.message === "Unsupported artwork host" ? "Artwork host is unsupported" : "Artwork could not be loaded" }, { status: error instanceof Error && error.message === "Unsupported artwork host" ? 400 : 502 });
  }

  });
}
