// Public HTML can contain share metadata while account APIs still enforce ownership.
const ordinaryPreviews = new Set(["/home", "/discover", "/search", "/library", "/liked", "/library/downloaded", "/profile", "/settings", "/import", "/onboarding", "/bloom"]);
export function isMetadataPreviewPath(path: string) {
  return ordinaryPreviews.has(path) || /^\/(?:artist|album|track|playlist|mix|bloom)\/[^/]+$/.test(path);
}
