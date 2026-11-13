import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/rebuild/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/privacy", "/terms"].map(path => ({ url: absoluteSiteUrl(path), changeFrequency: "monthly", priority: path === "/" ? 1 : 0.4 }));
}
