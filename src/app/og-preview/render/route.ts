import { getOgPreviewPage, isOgDirection, isOgFixture } from "@/rebuild/og/catalog";
import { renderOgPreview } from "@/rebuild/og/image";
import { encodeOgImage, isOgImageFormat, ogImageMime } from "@/rebuild/og/encode";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const direction = query.get("option") || "a";
  const fixture = query.get("sample") || "original";
  const format = query.get("format") || "png";
  if (!isOgDirection(direction) || !isOgFixture(fixture) || !isOgImageFormat(format)) {
    return new Response("Unknown preview option.", { status: 400, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  }
  const page = getOgPreviewPage(query.get("page") || "default", fixture);
  if (!page) return new Response("Unknown preview page.", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  const image = await renderOgPreview(page, direction);
  const bytes = await encodeOgImage(new Uint8Array(await image.arrayBuffer()), format);
  return new Response(new Uint8Array(bytes), { headers: {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Type": ogImageMime(format),
    "Content-Length": String(bytes.length),
    "Content-Disposition": `inline; filename="sakura-${page.id}-${direction}.${format === "jpeg" ? "jpg" : format}"`,
  } });
}
