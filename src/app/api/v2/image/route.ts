import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { approvedArtworkUrl } from "@/rebuild/player/imagePolicy";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_BYTES = 8 * 1024 * 1024;
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw || raw.length > 3000) return NextResponse.json({ error: "An artwork URL is required" }, { status: 400 });
  try {
    let url = approvedArtworkUrl(raw);
    const signal = AbortSignal.timeout(8000);
    let response: Response | undefined;
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetch(url, { signal, redirect: "manual", cache: "force-cache", next: { revalidate: 604800 }, headers: { "User-Agent": "Sakura/2.0 artwork", Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
      if (response.status < 300 || response.status > 399) break;
      const location = response.headers.get("Location");
      if (!location) throw new Error("Artwork redirect is missing");
      url = approvedArtworkUrl(new URL(location, url).toString());
    }
    if (!response?.ok || !response.body) return NextResponse.json({ error: "Artwork is unavailable" }, { status: 404 });
    const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() || "";
    if (!TYPES.has(type)) return NextResponse.json({ error: "Artwork format is unsupported" }, { status: 415 });
    if (Number(response.headers.get("Content-Length")) > MAX_BYTES) return NextResponse.json({ error: "Artwork is too large" }, { status: 413 });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_BYTES) { await reader.cancel(); return NextResponse.json({ error: "Artwork is too large" }, { status: 413 }); }
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    const cacheControl = "public, max-age=604800, stale-while-revalidate=2592000, stale-if-error=2592000";
    if (request.headers.get("If-None-Match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
    return new NextResponse(bytes, { headers: { "Content-Type": type, "Content-Length": String(length), "Cache-Control": cacheControl, ETag: etag, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "Unsupported artwork host" ? "Artwork host is unsupported" : "Artwork could not be loaded" }, { status: error instanceof Error && error.message === "Unsupported artwork host" ? 400 : 502 });
  }
}
