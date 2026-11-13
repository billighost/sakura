import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublicShare } from "../player/SharedSong";
import { deliverArtwork } from "../player/artworkDelivery";
import { readPublicShare, validShareSlug } from "../data/shares";
import { decodedEntityId, readPublicEntityPreview, validPublicEntityId, type PublicEntityKind, type PublicEntityPreview } from "../seo/public-data";
import { entityOgData, shareOgData } from "../seo/entity";
import { type OgPreviewPage } from "./catalog";
import { ogDirectionFor, OG_IMAGE_REVISION } from "./selections";
import { encodeOgImage, ogImageMime, type OgImageFormat } from "./encode";
import { prepareOgArtwork, renderOgImage } from "./image";

const kinds = new Set<PublicEntityKind>(["artist", "album", "track", "playlist", "mix"]);
type ImageBytes = Uint8Array;
export interface EncodedOgImage { bytes: ImageBytes; artworkComplete: boolean }
interface RenderedImage { image: EncodedOgImage; expires: number }

/** Retain only rendered public fields, with independent byte and work limits. */
export function createOgRenderer(render: (page: OgPreviewPage, format: OgImageFormat) => Promise<ImageBytes | EncodedOgImage>, limits: { maxConcurrent?: number; maxEntries?: number; maxBytes?: number } = {}) {
  const values = new Map<string, RenderedImage>();
  const flights = new Map<string, Promise<EncodedOgImage | undefined>>();
  let retained = 0;
  const remove = (key: string) => { const value = values.get(key); if (value) retained -= value.image.bytes.byteLength; values.delete(key); };
  return async (page: OgPreviewPage, format: OgImageFormat): Promise<EncodedOgImage | undefined> => {
    const key = createHash("sha256").update(JSON.stringify([OG_IMAGE_REVISION, ogDirectionFor(page.id), page, format])).digest("hex");
    const hit = values.get(key);
    if (hit && hit.expires > Date.now()) { values.delete(key); values.set(key, hit); return hit.image; }
    remove(key);
    const pending = flights.get(key);
    if (pending) return pending;
    if (flights.size >= (limits.maxConcurrent ?? 2)) return undefined;
    const work = Promise.resolve().then(() => render(page, format)).then(result => {
      const image = result instanceof Uint8Array ? { bytes: result, artworkComplete: true } : result;
      if (image.artworkComplete && image.bytes.byteLength <= (limits.maxBytes ?? 8 * 1024 * 1024)) {
        remove(key); values.set(key, { image, expires: Date.now() + 600_000 }); retained += image.bytes.byteLength;
        while (values.size > (limits.maxEntries ?? 32) || retained > (limits.maxBytes ?? 8 * 1024 * 1024)) remove(values.keys().next().value!);
      }
      return image;
    }).catch(() => undefined).finally(() => { flights.delete(key); });
    // Crawler requests get a branded fallback if rendering takes too long. The
    // work remains counted until it ends, so timed-out work cannot fill memory.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 10000); })]).finally(() => { if (timer) clearTimeout(timer); });
    flights.set(key, bounded);
    return bounded;
  };
}

async function renderPublicImage(page: OgPreviewPage, format: OgImageFormat) {
  const direction = ogDirectionFor(page.id);
  const sources = [...new Set([page.artwork, page.darkArtwork, ...(page.collage || [])].filter((url): url is string => Boolean(url)))].slice(0, 4);
  const artwork: Record<string, string> = {};
  const results = await Promise.allSettled(sources.map(async source => {
    const delivered = await deliverArtwork(source, AbortSignal.timeout(6000));
    const prepared = await prepareOgArtwork(delivered.bytes, direction === "c" && (page.kind === "artist" || page.kind === "lyric"));
    return { source, prepared };
  }));
  for (const result of results) if (result.status === "fulfilled") {
    artwork[result.value.source] = result.value.prepared.normal;
    if (result.value.prepared.flower) artwork[result.value.source + "#flower"] = result.value.prepared.flower;
  }
  const response = await renderOgImage(page, direction, artwork);
  return { bytes: new Uint8Array(await encodeOgImage(new Uint8Array(await response.arrayBuffer()), format)), artworkComplete: results.every(result => result.status === "fulfilled") };
}
const render = createOgRenderer(renderPublicImage);

interface ImageDependencies {
  entity: (kind: PublicEntityKind, id: string) => Promise<PublicEntityPreview | undefined>;
  share: (slug: string) => Promise<PublicShare | undefined>;
  render: (page: OgPreviewPage, format: OgImageFormat) => Promise<EncodedOgImage | undefined>;
  fallback: (page: string, format: OgImageFormat) => Promise<ImageBytes>;
}
const defaults: ImageDependencies = {
  entity: readPublicEntityPreview, share: readPublicShare, render,
  fallback: async (page, format) => new Uint8Array(await readFile(join(process.cwd(), "public/og", page + (format === "webp" ? ".webp" : ".jpg")))),
};

/** Every collection/share request checks the authoritative row before image reuse. */
export function createPublicOgHandler(dependencies: Partial<ImageDependencies> = {}) {
  const readers = { ...defaults, ...dependencies };
  return async (request: Request, kind: string, rawId: string): Promise<Response> => {
    const id = decodedEntityId(rawId);
    const format = new URL(request.url).searchParams.get("format") || "jpeg";
    if (format !== "jpeg" && format !== "webp") return new Response("Unknown image format.", { status: 400, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    const isShare = kind === "share";
    if (isShare ? !validShareSlug(id) : !kinds.has(kind as PublicEntityKind) || !validPublicEntityId(kind as PublicEntityKind, id)) return new Response("Unknown preview.", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    const accountCollection = kind === "playlist" || kind === "mix";
    let data: OgPreviewPage | undefined;
    let status = 200;
    try {
      if (isShare) {
        const share = await readers.share(id);
        if (!share) status = 404;
        else data = shareOgData(share);
      } else {
        const entity = await readers.entity(kind as PublicEntityKind, id);
        if (entity) data = entityOgData(kind as PublicEntityKind, entity);
      }
    } catch { status = 503; }
    const fallbackPage = isShare ? "shared-track" : kind;
    const rendered = data ? await readers.render(data, format) : undefined;
    const bytes = rendered?.bytes || await readers.fallback(fallbackPage, format);
    const etag = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
    const headers: Record<string, string> = {
      "Content-Type": ogImageMime(format), "Content-Length": String(bytes.byteLength),
      "Cache-Control": isShare || accountCollection || !rendered?.artworkComplete ? "no-store" : "public, max-age=300, s-maxage=300",
      "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", ETag: etag,
    };
    if (status === 200 && rendered?.artworkComplete && request.headers.get("if-none-match") === etag) { delete headers["Content-Length"]; return new Response(null, { status: 304, headers }); }
    return new Response(new Uint8Array(bytes), { status, headers });
  };
}
export const publicOgResponse = createPublicOgHandler();
