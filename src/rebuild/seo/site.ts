const documentedOrigin = "https://sakura-orcin.vercel.app";

export function resolveSiteOrigin(value?: string) {
  if (!value?.trim()) return documentedOrigin;
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("SAKURA_SITE_URL must be a public origin, without credentials, a path, or query parameters.");
  return url.origin;
}
export const SITE_ORIGIN = resolveSiteOrigin(process.env.SAKURA_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined));
export function absoluteSiteUrl(path: string) { return new URL(path, SITE_ORIGIN).toString(); }

export const WEBSITE_SCHEMA = {
  "@context": "https://schema.org", "@type": "WebSite", name: "Sakura", url: SITE_ORIGIN,
  description: "A personal music world for favorite songs, new discoveries, playlists, synchronized lyrics, and offline listening.", inLanguage: "en",
};
