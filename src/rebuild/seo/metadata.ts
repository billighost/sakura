import type { Metadata } from "next";
import { OG_PAGES, OG_SIZE, type OgPreviewPage } from "../og/catalog";
import { OG_IMAGE_REVISION } from "../og/selections";
import { absoluteSiteUrl } from "./site";

export function cleanPreviewText(value: unknown, limit = 160): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return [...text].length > limit ? [...text].slice(0, limit - 1).join("").trimEnd() + "…" : text;
}
export function staticOgImagePath(page: string, format: "jpeg" | "webp" = "jpeg") { return `/og/${page}.${format === "jpeg" ? "jpg" : "webp"}?v=${OG_IMAGE_REVISION}`; }
export function entityOgImagePath(kind: string, id: string) { return `/og/${kind}/${encodeURIComponent(id)}?v=${OG_IMAGE_REVISION}`; }

export function staticOgData(id: string): OgPreviewPage {
  const sample = OG_PAGES.find(page => page.id === id) || OG_PAGES[0];
  const page: OgPreviewPage = { ...sample, artwork: undefined, darkArtwork: undefined, collage: undefined };
  const defaults: Record<string, Partial<OgPreviewPage>> = {
    artist: { title: "An artist to\ncome back to.", subtitle: "Find a voice that stays with you.", detail: "Artists on Sakura", description: "Find your favorite artists, albums, and songs on Sakura." },
    album: { title: "One album.\nA little world.", subtitle: "Make a little room for the music.", detail: "Albums on Sakura", description: "Explore albums and listen at your own pace on Sakura." },
    track: { title: "A song for\nyour day.", subtitle: "Music, with a little soul.", detail: "Listen on Sakura", description: "Listen to your favorite songs, follow synchronized lyrics, and discover more on Sakura." },
    playlist: { title: "A little\ncollection.", subtitle: "Good songs, all together.", detail: "A playlist on Sakura", description: "A collection of songs on Sakura. Open the playlist and find your own pace." },
    mix: { title: "Just your kind\nof music.", subtitle: "Good songs. No hurry.", detail: "A Sakura mix", description: "A Sakura mix. Settle into your next favorite song and stay a little longer." },
    "shared-track": { title: "A song,\nshared with you.", subtitle: "Sent with a little soul.", detail: "A little music from Sakura", description: "Someone saved you a song. Open this shared recording on Sakura." },
    lyric: { title: "Some words\nstay with you.", subtitle: "A little moment from a song.", detail: "Shared from Sakura", description: "A few words, shared from Sakura. Open the song and listen to this moment." },
    "bloom-story": { eyebrow: "SAKURA BLOOM", subtitle: "Your music, remembered in songs.", detail: "A listening story from Sakura", description: "A month of music, a world of you. A listening story in Sakura Bloom." },
  };
  if (id === "bloom" || id === "bloom-story") {
    page.artwork = sample.artwork;
    page.darkArtwork = sample.darkArtwork;
  }
  return { ...page, ...defaults[id] };
}

export function makeShareMetadata(input: { title: string; description: string; path: string; image: string; alt?: string; indexable?: boolean }): Metadata {
  const title = cleanPreviewText(input.title, 120);
  const description = cleanPreviewText(input.description, 180);
  const shareTitle = title === "Sakura — your little music world" || title === "About Sakura" ? title : title + " · Sakura";
  const url = absoluteSiteUrl(input.path);
  const image = absoluteSiteUrl(input.image);
  const alt = cleanPreviewText(input.alt || shareTitle, 220);
  return {
    title: { absolute: shareTitle }, description, alternates: { canonical: url },
    openGraph: { type: "website", siteName: "Sakura", locale: "en_US", url, title: shareTitle, description, images: [{ url: image, secureUrl: image, ...OG_SIZE, type: "image/jpeg", alt }] },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [{ url: image, alt }] },
    robots: { index: Boolean(input.indexable), follow: true },
  };
}
export function staticPageMetadata(id: string): Metadata {
  const data = staticOgData(id);
  const title = id === "default" ? "Sakura — your little music world" : data.label;
  const path = data.route.includes("[") ? "/" + (id === "bloom-story" ? "bloom" : id) : data.route;
  return makeShareMetadata({ title, description: data.description, path, image: staticOgImagePath(id), alt: "Sakura — " + cleanPreviewText(data.title), indexable: data.visibility === "public" });
}
