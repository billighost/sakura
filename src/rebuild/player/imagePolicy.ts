const ALLOWED_ARTWORK_HOSTS = ["dzcdn.net", "scdn.co", "spotifycdn.com", "res.cloudinary.com", "lastfm.freetls.fastly.net", "lastfm-img2.akamaized.net", "mzstatic.com"];
export function approvedArtworkUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !ALLOWED_ARTWORK_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("Unsupported artwork host");
  return url;
}
