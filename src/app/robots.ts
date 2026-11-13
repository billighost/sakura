import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/rebuild/seo/site";

export default function robots(): MetadataRoute.Robots {
  // Page metadata keeps account/share pages out of search without blocking previews.
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/og-preview"] }, sitemap: absoluteSiteUrl("/sitemap.xml") };
}
