/** Remote artwork always crosses our bounded same-origin image endpoint. */
export function sameOriginArtworkUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("blob:")) return url;
  return `/api/v2/image?url=${encodeURIComponent(url)}`;
}

const ARTWORK_WIDTHS = [96, 192, 320, 640, 1000];

/**
 * Catalogs supply their largest cover even for a 48px row. Deezer exposes the
 * same artwork at smaller native sizes, so the browser can choose by layout
 * and pixel density without sending every cover through a resize service.
 * Other providers, signed URLs, local assets and exported artwork stay intact.
 */
export function responsiveArtworkSources(raw: string | null | undefined, proxy = false) {
  const original = proxy ? sameOriginArtworkUrl(raw) : raw || null;
  if (!raw) return { src: original, srcSet: undefined };
  try {
    const url = new URL(raw);
    const size = /^(\/images\/(?:cover|artist|playlist)\/[a-f\d]{32}\/)(\d+)x\2(-\d+-\d+-\d+-\d+\.jpg)$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !/(^|\.)dzcdn\.net$/.test(url.hostname) || !size) return { src: original, srcSet: undefined };
    const maximum = Number(size[2]);
    const widths = ARTWORK_WIDTHS.filter(width => width <= maximum);
    if (!widths.length) return { src: original, srcSet: undefined };
    if (maximum < 1000 && !widths.includes(maximum)) widths.push(maximum);
    const source = (width: number) => {
      const variant = new URL(url);
      variant.pathname = `${size[1]}${width}x${width}${size[3]}`;
      return proxy ? sameOriginArtworkUrl(variant.toString())! : variant.toString();
    };
    const fallback = widths.filter(width => width <= 320).at(-1) || widths[0];
    return { src: source(fallback), srcSet: widths.map(width => `${source(width)} ${width}w`).join(", ") };
  } catch {
    return { src: original, srcSet: undefined };
  }
}
