/** Remote artwork always crosses our bounded same-origin image endpoint. */
export function sameOriginArtworkUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("blob:")) return url;
  return `/api/v2/image?url=${encodeURIComponent(url)}`;
}
