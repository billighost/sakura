# Sakura OG images and SEO

Sakura uses the owner's approved designs for all 26 page contexts. `src/rebuild/og/selections.ts` records the choices: **B — After Hours** for artists, albums, playlists, mixes, Bloom, Home, Discover, Search, and Library; **C — Petal Press** for the website/fallback, songs, shared songs and lyrics, liked songs, downloads, and the remaining account and information pages.

## Formats and assets

Images are 1200 × 630. Social metadata points to optimized **JPEG** images because [Meta's sharing specification](https://developers.facebook.com/docs/sharing/webmasters/) lists JPEG, PNG, and GIF. Browser previews use **WebP**. Both formats are generated for all 26 static contexts in `public/og/`. The manifest records each selected direction, size, dimensions, and hash. Static JPEGs are 50–66 KB; WebP copies are 28–38 KB.

Layouts, texture, petals, botanical geometry, typography, rings, and record sleeves are code. Sakura's existing `Brand.tsx` supplies the mark. Production fallbacks use brand copy and generated artwork. Bloom uses Sakura's existing code-authored world covers. Illustrative catalogue photographs in the review gallery belong to their respective owners; sources and licenses are in `public/og-preview/`.

Inter and Fraunces are bundled with their available character sets. Local Noto font shards cover Japanese, simplified Chinese, Korean, Arabic, Devanagari, Thai, and Hebrew; only needed shards are loaded. Titles use glyph advances, authored breaks, and bounded wrapping. Captions stay clear of the footer. Font preparation converts equivalent context-only GSUB format 3 tables to the chained form supported by this installed Next/Satori build.

## Metadata and public previews

The root layout supplies metadataBase, a fallback OG image, title and description, site name, locale, absolute image URLs, JPEG type, dimensions, alt text, Twitter large-image cards, and WebSite structured data. Every ordinary page has its selected image, description, and canonical URL. Existing icons and PWA metadata remain in place.

The documented production origin is **https://sakura-orcin.vercel.app**. Set `SAKURA_SITE_URL` or `NEXT_PUBLIC_SITE_URL` when changing the primary domain; `VERCEL_PROJECT_PRODUCTION_URL` is also supported. Canonicals use this validated configuration rather than the incoming Host header.

Artist, album, song, playlist, and mix pages load real public preview fields and point to `/og/{kind}/{id}`. Shared song and lyric pages use `/og/share/{slug}` with the public share's real song information, artwork, and selected excerpt. Endpoints return JPEG by default; `?format=webp` returns WebP. Unknown kinds, invalid identifiers, and unsupported formats are rejected.

Missing artwork produces a complete branded card. Failed artwork and incomplete renders are not cached, allowing the next request to retry. Artwork delivery uses the existing validated host/redirect policy and byte limits. Catalogue reads avoid recommendation generation, ingestion, audio worker initialization, and account writes. Reads, rendering, queues, retained bytes, and timeouts are bounded. The production route traces its fonts, artwork, and fallback files for deployment.

On 2026-11-13, the owner explicitly approved **public playlist and personalized mix names and artwork** to anyone with the link. Preview reads select only those fields and up to four cover images. They exclude account identity, collection descriptions, listening evidence, audio locations, and editing access. Playlist and mix APIs still enforce authentication and ownership. Privacy copy explains the visible collection fields.

Every collection/share image request reads the authoritative record before image reuse. These responses use `no-store`; deleted shares cannot return a retained image or stale 304. The public share page and its metadata use a React request cache, while the underlying reader only coalesces concurrent requests. Deletion remains visible on the next read.

The proxy permits public preview HTML and images. Account data and actions remain protected by their APIs. Anonymous root visitors see a branded landing page; signed-in visitors continue to `/home`. Root, About, Privacy, and Terms are indexable and appear in the sitemap. Music/account/share pages have noindex metadata. Robots permits public pages and OG images without the old blanket block. The review gallery is noindex, nofollow.

This Next.js installation's default HTML-limited bot list recognizes WhatsApp, Facebook sharing crawlers, and Twitterbot and puts their dynamic metadata in the HTML head. No custom expression replaces those defaults.

## Gallery and regeneration

Open `/og-preview` to review **A — Paper & Petals**, **B — After Hours**, and **C — Petal Press**. The gallery starts with the approved choices and supports local edits, copied/downloaded selections, WhatsApp-style cards, full-size viewing, PNG downloads, and long-title/missing-artwork samples. Gallery edits do not publish new selections; production uses `selections.ts`.

```sh
# Regenerate selected production JPEG/WebP assets:
npm run generate:og

# Export all three gallery options and contact sheets:
npm run render:og
npm run render:og -- --pages=artist,album,playlist,lyric --long
npm run render:og -- --pages=artist,album,playlist,mix,bloom --missing

# Prepare licensed fonts and illustrative assets (network + Python/fontTools/Pillow):
npm run prepare:og
npm run prepare:og:fonts
```

Rendering uses checked-in assets. Review exports, screenshots, native-language examples, and reports go to the gitignored `.local/og-preview/` directory.

## Verification and preference saves

```sh
npm run test:seo
# With a development or production server running:
npm run test:seo:browser
npm run test:og:browser
# Use SAKURA_TEST_URL to check another local/staging server.
```

Tests cover encoded images, choices, fallback copy, public-field boundaries, render limits, artwork retry, collection renames, share revocation, local multilingual fonts, and missing artwork. Browser checks inspect anonymous WhatsApp/Meta/Twitter metadata and images, real catalogue and available database entities, protected account APIs, robots, sitemap, the public landing, and preference persistence and reconnection. Gallery checks cover saved choices, downloads, stress samples, dialogs, and mobile fitting. Production build and output tracing are checked separately.

The removed preference notice stays silent after a durable device save when account sync is unavailable. Pending operations remain intact; reconnecting retries them, and only a valid server receipt acknowledges the save. Background synchronization after reloading saved preferences follows the same behavior. Storage failures that prevent a durable save, authentication errors, and genuine conflicts still report errors.

The implementation is local until deployed. WhatsApp can retain previously fetched cards; verify a fresh deployed link or refreshed platform scrape after release.
