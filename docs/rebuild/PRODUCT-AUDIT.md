# Sakura product and platform audit

Reviewed on 2026-11-07. This is a source audit plus a read-only snapshot of the configured PostgreSQL database. Phone overflow was reported by the owner; this report does not claim a device reproduction. Audio matching and lyric accuracy have separate audits. New recommendation code is independent of the legacy app and is not wired into production yet.

## Evidence from the live data

| Observation | Snapshot result | Interpretation |
| --- | --- | --- |
| Accounts / tracks / artists | 2 / 408 / 195 | Preserve both accounts before cleaning catalog data. |
| Raw history / aggregate rows | 523 / 139 | Both tables carry listening time. |
| Actual audible milliseconds | 78,398,001 raw + 55,732,139 aggregated | 134,130,140 ms = approximately 37.258 hours across both accounts. This is not the owner's individual total. |
| Same title, artist ID and duration | 93 duplicate candidate groups, 95 excess rows | Strong evidence of identity fragmentation; validate recording/version equivalence before merging. |
| Duplicated ISRC | 4 groups, 4 excess rows | Canonical recording aliases need a constraint and reconciliation. |
| Telegram message sentinel | 150 tracks have message ID `0` | These are unresolved/sentinel references, not 150 duplicated positive messages. |
| Missing artist pictures | 50, all also lack Deezer ID | The current detail route cannot enrich those artists. |
| Current mixes | 3, all contain virtual IDs | The home playback filter excludes their virtual candidates. |
| Mix overlap | Mean 22.22%, maximum 66.67% of the shorter list | Measured on three same-account pairs. Small sample, but a clear repeated-content problem. |

Reproduce with `node scripts/rebuild-data-audit.mjs`. It executes only SELECTs inside a repeatable-read, read-only transaction and prints aggregate counts, never account identities.

## Confirmed defects and replacement requirements

Severity: P0 = data/security integrity; P1 = core listening or navigation broken; P2 = quality/performance/accessibility.

| Priority | Finding and source evidence | New implementation requirement |
| --- | --- | --- |
| P0 | `src/lib/historyRetention.ts:156` additively upserts aggregates, then `:184` separately deletes old raw history. A crash between them or concurrent runs can count the same plays twice. The delete uses a new `NOW()` cutoff rather than captured row IDs. | One transaction, explicit selected event IDs, a fixed cutoff, concurrency exclusion and rollback tests. No additive upsert outside that transaction. |
| P0 | `src/app/api/export/route.ts:29` exports only play dates and labels, omits `msPlayed` and `PlayAggregate`, and `:37` caps history at 5,000. It cannot preserve lifetime hours. | Full snapshot of audible time, aggregates, track references and account data; checksums and reconciliation before cleanup. The new private scripts implement this first step. |
| P0 | `src/app/api/image-proxy/route.ts:4` accepts any URL, is unauthenticated, follows redirects, and buffers the response without size, timeout, protocol or destination checks. | Allowlisted artwork providers, HTTPS, redirect revalidation, bounded stream/time/bytes and checked image MIME. Do not expose arbitrary server fetch. |
| P1 | `src/app/(app)/home/HomeFeed.tsx:79` filters out `audioUrl: ''`, while `src/app/api/mixes/[id]/route.ts:90` deliberately returns that state for virtual songs needing resolution. | Determine playability from a typed source/resolution state. A direct mix play must pass all resolvable recordings into the same playback pipeline as its detail page. |
| P1 | `src/components/MediaCard.tsx:109`, `HomeFeed.tsx:37` and `:362` also reject empty audio URLs. | Eliminate scattered truthy-URL playability rules. The UI cannot infer whether a recording can stream from whether it already has an audio asset. |
| P1 | `src/components/QueueModal.tsx:147` supplies no `onSelect` for Up Next. `src/components/TrackRow.tsx:253` falls back to the normal play action; `:370` binds it to the row. A comment calling the rows unselectable does not disable playback. | Select queue occurrences by an occurrence ID and preserve the queue. Distinguish recording identity from a repeated song's position in a queue. |
| P1 | `src/lib/offline-db.ts:132` defines `setCachedUserId`, but a repository search finds no callers. `:125` defaults to `anon`. Authenticated client caches never bootstrap the authenticated account identity. | Initialize a session-scoped cache namespace from authenticated data, not an optional unrelated localStorage value. Reset it at account boundaries. |
| P1 | `src/app/(app)/settings/page.tsx:391` does not check the sign-out response. Failed sign-out is swallowed and `:424` redirects to login; a still-valid cookie can redirect straight back into the account. | Confirm server sign-out; provide retry on real failure. Clear client account state after success with a defined offline logout behavior. |
| P1 | `src/proxy.ts:61` preserves a protected destination in `next`, but `src/app/(auth)/login/page.tsx:49` always pushes `/home`. | Validate and honor relative return destinations; reject cross-origin redirects. Returning from sign-in should complete the original navigation. |
| P1 | `src/app/api/profile/route.ts:82` sums full track duration for each raw history event. It does not use actual `msPlayed` and never includes `PlayAggregate`. | Sum raw audible milliseconds plus aggregate audible milliseconds. Keep daily listening summaries separately if year/month charts must survive raw event retention. |
| P1 | `src/lib/mixes.ts:212` reuses the same seed artists for every daily genre, while `src/lib/catalog.ts:451` puts all seeds in each pool before genre candidates and `:465` takes the first 24 artists. | Genre fit must affect candidate eligibility and relevance, not just shelf labels. Plan the entire shelf together with measured pairwise overlap limits. |
| P1 | `src/lib/catalog.ts:478` only caps songs per artist and shuffles artist buckets. Top songs per artist remain the same; there is no cross-mix reservation or recent-play novelty budget. | Rotate recordings using a stable day seed, balance familiarity/discovery, apply recent/snoozed/blocked exclusions and cap overlap without padding sparse shelves. |
| P1 | `src/app/api/artists/[id]/route.ts:135` only knows a local artist's already-stored Deezer ID. Artwork enrichment at `:183` runs only when that ID exists. | Resolve missing provider aliases through an audited artist resolver. Persist normalized artwork, provenance and refresh state; all pages read one artist entity. |
| P1 | `src/app/api/artists/[id]/route.ts:180` labels every globally stored track `isDownloaded: true`. A server catalog row cannot know which device has its bytes. | Separate catalog availability from device download status. Device state comes from validated local asset manifests. |
| P1 | `src/lib/shareAudio.ts:174` calls `fetch(url)` to create a blob. This still requires the remote origin to allow CORS; fetching a cross-origin URL does not bypass CORS. `VideoStep.tsx:92` depends on it. | Resolve an exportable asset through a same-origin authenticated endpoint or a CORS-enabled CDN; report unsupported/unavailable audio before rendering. |
| P1 | `src/components/share/ShareStudio.tsx:97` awaits link creation before `:113` calls `navigator.share` indirectly. Encoding plus another network wait loses transient user activation. | Prepare first, then show an explicit ready-state Share button whose click synchronously invokes the platform share sheet. Save/copy remain independent fallbacks. |
| P2 | `QueueModal.module.css:32` places `TrackRow` in a flex wrapper; `TrackRow.module.css:12` has neither `flex: 1` nor `min-width: 0` on that flex child. `Sheet.module.css:191` only specifies vertical overflow. This is a plausible horizontal overflow path with many fixed controls/long metadata. | Sheet grid uses `minmax(0,1fr)`; content and track text have explicit shrink bounds; pin header/footer; scroll only body. Verify long titles at 320/360/390px and landscape heights. |
| P2 | `src/components/TrackRow.tsx:400` makes the title an inspection link, while the surrounding row plays. In queue views with `hidePlayButton`, the main play action is an unfocusable clickable div. | Give the main play action an actual accessible button and clear visual affordance. Artist/album links inspect. A visible menu offers detail/versions. Avoid nested interactive buttons. |
| P2 | `src/app/(app)/artist/[id]/ArtistClient.tsx:140` and `album/[id]/AlbumClient.tsx:115` paint IDB data but always fetch afterward. Mix `:43`, playlist `:86`, profile `:83` do plain fetches. The fresh in-memory abstraction `src/lib/useOfflineData.ts:87` has zero consumers. | One scoped query/cache layer with freshness, shared in-flight requests, abort ownership, mutation invalidation and stale indicators. Back navigation restores content and scroll immediately. |
| P2 | The dormant `useOfflineData.ts:34` uses unscoped memory keys/BroadcastChannel data; `:292` clears maps but not pending request ownership or listeners. No active consumers means this is a design hazard, not a proven active cache leak. | A cache generation/abort boundary prevents old-account requests from repopulating a new account; scope messages and keys by authenticated user. |
| P2 | `src/lib/apiBatch.ts:29` allows 20 entries, but `src/app/api/batch/route.ts:40` rejects more than 12. The library currently sends three, so the defect activates when batching expands. | Share a contract constant and test the exact boundary plus overflow splitting. |
| P2 | `src/lib/virtualTracks.ts:59` does read/modify/write on one Redis metadata object. Concurrent regeneration can overwrite additions. `src/app/api/mixes/[id]/route.ts:82` silently drops missing metadata. | Persist mix recording snapshots/aliases atomically with ordered entries; cache is disposable acceleration, not the sole source of mix titles and playback metadata. |
| P2 | `prisma/schema.prisma:398` indexes `(userId,kind,slot)` without a unique constraint; `mixes.ts` regeneration has no generation/version contract. | Transactional generation with a stable shelf key and version; old detail URLs remain intelligible through replacement/expiry records. |
| P2 | `src/app/api/artists/route.ts:39` has `WHERE favorite_exists OR playlist_exists AND downloaded_exists`; the list query at `:62` correctly parenthesizes the two ownership alternatives. Counts can diverge when filters change. Numeric paging at `:15` permits negative or NaN limits. | One shared filter predicate and bounded integer parsing used for both list and count. |
| P2 | `src/lib/shareCard.ts:99` hardcodes literal `Fraunces`/`Inter`, while root `next/font` exposes generated font families via CSS variables. Canvas exports can silently use fallbacks. | Resolve actual computed font-family tokens before measurement/rendering. Test Japanese glyph fallback and line wrapping in exported dimensions. |
| P2 | `src/components/LogoLoader.tsx:82` reads sessionStorage without a catch; storage denial can throw in a layout effect. It blocks the first screen for 1,800ms plus exit even when ready; reduced-motion still waits 900ms. | Opening animation is optional and interruptible, does not gate navigation/playback, uses transform/opacity with a reduced-motion still state, and handles unavailable storage. |
| P2 | `public/sw.js:253` waits up to 2.5 seconds before showing cached documents and, with no cache, awaits an unbounded network request after that. API and RSC paths bypass SW intentionally. | Warm navigation uses application/router cache; cold offline launch uses a deterministic shell and local data. A failed network should not obscure available downloads. |

## Route and interaction inventory for the new product

| Area | Reviewed existing entry points | Required connected behavior |
| --- | --- | --- |
| Entry/account | `/`, `/login`, `/register`, `/onboarding` | Resume intended route; select taste; browse before unnecessary prompts; opening animation never blocks. |
| Listening home | `/home`, `/mix/[id]`, `/playlist/system/[id]` | Direct Play/Shuffle and inspect are separate; quick picks stream; mixes explain their distinct purpose. |
| Discovery | `/search`, `/browse/[kind]/[id]`, artist/album/track details | Search → play or inspect; versions/explicit/remix labels appear before the user selects audio. Preserve search state and return location. |
| Library | `/library`, `/liked`, `/library/downloaded`, `/playlist/[id]`, `/import` | Saved library is account data; Downloaded is device bytes. Import has preview/duplicates/version validation and a reversible result. |
| Player | MiniPlayer, FullPlayer, QueueModal, LyricsModal | One uninterrupted player; dedicated Now Playing route/state; queue selection preserves order; lyrics follow actual play position. |
| Share | ShareStudio, image/video steps, `/s/[slug]` | Prepare → ready preview → user Share/Save/Copy; stable public link; lyrics select a bounded excerpt and clear context. |
| Personal | `/profile`, `/settings` | Actual listening hours and preserved baseline; theme/audio/download/accessibility preferences; reliable logout. |
| Service/legal | `/offline`, `/about`, `/terms`, `/privacy`, route error/loading states | Deterministic recovery, working download access offline, accessible error/retry flow and public shared-link landing. |

The new navigation should keep Home, Search and Library continuously available, expose Downloads under Library, and keep the player anchored across every screen. Artist/album/mix/playlist inspection should share predictable back behavior. Modal dismissal should dismiss the visible overlay before leaving the route.

## New recommendation foundation delivered

`src/rebuild/recommendations/planner.ts` is an independent provider-neutral selector. It receives canonical recording IDs, explicit genre evidence and listening signals. It enforces block/snooze/recent-play exclusions, distinct daily/discovery/deep-cut/repeat intent, per-artist caps, reproducible day rotation, recording deduplication and pairwise shelf overlap. A short pool produces an honest insufficient-candidates result instead of repeated filler.

Eight meaningful tests pass with:

```powershell
node --experimental-strip-types --test src/rebuild/recommendations/planner.test.mjs
```

Candidate retrieval, calibrated affinity scoring, persistent generation/versioning and production playback integration remain required. The tests prove the selection contracts, not listener satisfaction or live-provider availability.

## Release checks for the replacement

1. Play the same recording from search, daily mix, artist, album and a saved playlist; its local download count stays one, versions stay separate, and stream playback works before saving.
2. Queue the same recording twice; selecting/removing/reordering one occurrence does not change the other. Test short/long queues with keyboard, screen reader and 320px phones.
3. Switch accounts mid-request and sign out with a failed connection; neither history nor cached screens cross account boundaries.
4. Reopen cached routes offline and online; preserve scroll/query and avoid duplicate fetches within freshness. Resume the PWA after an update during playback.
5. Export artwork and a short lyric image/video on iOS Safari and Android Chrome; cancel safely and share from an explicit ready-state click.
6. Crash/retry/concurrently run the retention job against a disposable database; raw + aggregate audible milliseconds remain exact.
7. Compare generated shelves on real listening histories: overlap, artist concentration, familiar/discovery share, skip rate and completion rate. Quality is measured, not inferred from random shuffling.
