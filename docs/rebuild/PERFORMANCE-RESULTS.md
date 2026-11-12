# Sakura performance implementation and verification

This report continues the 11 November 2026 performance/Redis conversation and
records the final integration work on 12 November. The original request covered
every API and the interactions using it: navigation, account startup and sync,
audio continuity, Bloom preparation, lyrics, artwork, video sharing and Redis.
The comprehensive plan was delivered before implementation in
[PERFORMANCE-PLAN.md](PERFORMANCE-PLAN.md).

## Delivered behavior

| Area | Implemented outcome |
| --- | --- |
| API coverage | All 52 Next API routes and 69 explicit HTTP methods carry handler timing. Shared authentication and transaction stages are measured without consuming streams or logging account/query/media secrets. The generated [inventory](API-INVENTORY.json) verifies coverage. |
| Startup | `/api/v2/bootstrap` verifies account identity without fetching profile analytics. Independent local hydration runs concurrently; usable local state precedes background reconciliation. |
| Account and synchronization | `/api/v2/library/state` provides compact favorite revisions and tombstones. Profile, playlist, history and listening projections use fewer database round trips while retaining account checks, locks, operation receipts and deletion semantics. |
| Recommendations | Exact indexed sequencing replaces repeated full-reservoir scans. Feed, hero, queue and Home reuse evidence and batch projections without truncating candidates or changing stable ordering. |
| Catalog and imports | Public provider calls share flights with independent cancellation. Artist requests run concurrently; unchanged artist/album metadata avoids redundant writes. Imports reuse tokens/previews and bound matching concurrency. |
| Navigation | Pointer, focus and touch intent populate the same caches used by visible feed, hero and collection views. Speculation is bounded and yields to audio startup, hidden/offline tabs and constrained connections. Collection transforms and rows are memoized. |
| Audio | Verified assets pass through resolution without redundant reads. Compatible document-bound worker URLs sign locally. The destination prepares while current audio continues; resume positions warm the relevant chunks. User pause, native pause and account changes cancel pending handoffs. |
| Bloom | Enter requires complete story data, world code, artwork and checksum-verified full soundtrack files. Preparation leases protect files while owned, then release before pruning. Bounded shelf preparation, finite artwork deadlines and snapshot checks prevent leaked or stale readiness. |
| Lyrics and readings | Canonical source identity, shared lyric prefetch and bounded provider searches reduce repeated work. Cached reading transformations preserve each caller's timing. Confirmed publication no longer waits for several indexing readbacks. |
| Artwork and sharing | Validated artwork bytes/ETags are reused. Video preparation reuses ready artwork and verified local audio, shares codec checks and bounds decoded memory. Account/source changes cancel preparation; final native sharing retains its required user gesture. |
| Redis | Upstash backs public provider metadata and verified public reading transforms after local cache misses. Ordinary local hits make no Redis request. Private account state, audio, tokens and unpublished lyric drafts remain outside Redis. |

Every original endpoint has its budget and reviewed behavior in the plan's
complete route checklist. The two added endpoints are the lightweight bootstrap
and compact favorite state above. Password hashing, authoritative deletion checks,
durable mutations and cold provider work retain their security/correctness
contracts; instrumentation alone is not evidence of a latency improvement.

## Final integration corrections

- Native media pauses now cancel an unfinished song handoff or pending Next
  selection, so an OS/headphone pause cannot later restart playback.
- Listening continues to be counted until the source is actually replaced;
  successful handoff retires its preparation cancellation handle before playback
  startup yields, preserving progressive reads after an immediate seek.
- Expired/unauthorized resources remain revoked when storage cleanup fails.
- The Bloom browser check waits for preparation pins to release before reopening
  offline, then verifies fresh pins from saved files and complete erasure cleanup.
- Older audio-route fixtures now stub the added timing dependency.
- Pointer/focus/touch intent now explicitly warms the route shell as well as its
  separate data. Shell work uses the bounded policy queue, remembers at most 32
  routes and becomes eligible again when Next reports cache invalidation.
- The production audio browser fixture now supplies revision and per-field
  receipts and enforces compare-and-swap for settings, matching the real API.

## Measurements and interpretation

The figures below distinguish observations from the plan's targets. Browser
fixtures use synthetic account responses and generated audio. They exercise
production UI and real browser storage/media, without measuring production
database or upstream-provider latency.

| Measurement | Result | Scope |
| --- | --- | --- |
| Prepared Bloom first-chapter paint | 113.8 ms | One local production run, reduced motion; not a p95. |
| Bloom offline reopen | Zero added preparation/provider requests | Saved complete files reopened after old pins and retained capabilities were released. |
| Prepared first Discover navigation | 84–116 ms; median 95.5 ms | Three local production contexts, click to content at the next frame; zero duplicate feed/hero requests. |
| Cached Home/Discover revisits | 33–65 ms | Twelve local production navigations, reduced motion. |
| Fresh usable shell / first feed | 1,406–1,546 ms / 1,801–1,995 ms | Artificial 40 ms bootstrap and 250 ms feed delays; fresh startup remains above 100 ms. |
| Exact sequencing, 2,500 candidates | 456.16 ms to 28.03 ms (16.27×) | Median of five same-process CPU samples, previous and current algorithms, equivalent output checked separately. |
| Exact sequencing, 600 candidates | 27.38 ms to 7.17 ms (3.82×) | Same final CPU fixture. |
| Prepared 5/8/12-second videos | 1.67 / 3.04 / 3.50 seconds to encode | Six real Chromium exports, including paired unprepared runs; exact 880 Hz source audio and output dimensions verified. |
| Prepared video input reuse | Zero additional audio requests/bytes or repeated card paints | Player continued unchanged; first progress callback in 0.1–0.2 ms. |
| Repeated Japanese reading transformation | 0.3–1.7 ms, previously 42–55 ms | Earlier 80-line compute fixture; cold dictionary initialization still takes about one second. |
| Calendar window computation | 9,938.26 ms to 692.86 ms (14.34×) | Earlier same-task comparison of 1,080 window pairs; CPU only. |
| Production mobile audio continuity | 8 browser checks passed; zero page errors | Song switching retained one media source and saved gain; reload restored volume without autoplay; an explicit Play survived a deliberately delayed session response. |

Raw final sequencing samples are summarized in
[PERFORMANCE-SEQUENCING.jsonl](PERFORMANCE-SEQUENCING.jsonl). Video details and the
optional `--benchmark` reproduction command are in
[MEDIA-PERFORMANCE-VERIFICATION.md](MEDIA-PERFORMANCE-VERIFICATION.md). Paired
unprepared exports took 2.61 / 3.62 / 3.10 seconds; variation in the 12-second
result means the evidence proves preparation reuse, not a universal encoder
speedup. Navigation fixtures made no profile analytics request before initial
interaction. The earlier first-Discover median was 127.5 ms; the three-context
comparison is too small and uncontrolled to claim a reliable percentage gain.
Reproduce with `SAKURA_TEST_URL` pointing at a local production server and
`node scripts/rebuild-production-navigation.mjs`. The fixture intercepts all API
requests and reports no page errors; it does not measure live API/DB latency.
For the production mobile audio checks, run `npm run build`, start it with
`npm run start -- --hostname 127.0.0.1 --port 3014`, then set
`SAKURA_TEST_URL=http://127.0.0.1:3014` and run
`node scripts/rebuild-production-mobile-volume.mjs`. The fixture uses generated
audio and intercepted account APIs, so it performs no database writes.

## Validation

- Final `npm test`: 852 tests passed across core, server, application,
  personalization, PWA and artwork batches, including manual-queue repeat and
  complete synced-LRC recognition regressions.
- Final production build: passed compilation, TypeScript, prerendering and
  tracing with Next 16.4.5 after the native-pause and route-shell corrections.
  Standalone `npx tsc --noEmit` also passed. The installed router's required
  `PrefetchKind.AUTO` is used explicitly for partial route prefetching.
- Full lint: zero errors, 20 warnings. Existing warning categories include hook
  dependencies, raw images, internal location navigation and worker module style.
- Bloom readiness/image/audio/refresh/service: 66 focused tests passed; scoped
  lint passed; strengthened production browser run had zero page errors.
- Final production PWA browser: 12 checks passed with zero page errors or blocked
  fixture writes, covering saved offline pages/audio, navigation/history, new
  offline tabs, reconnection receipts and stalled-bootstrap fallback.
- Public-reading/media/lyric/share focused suite: 41 tests passed.
- Final `npm run test:performance`: all 78 tests passed, including the real
  IndexedDB preparation-pin case; inventory reported no untimed methods.
- Final downloads/playback: 299 tests passed; Node worker: 57 passed.
- Final combined navigation, prefetch and playback integration: 181 tests passed
  after the native-pause and route-shell changes.
- Audio technology: 12 passed, one Windows WebKit/Web Audio skip; preparation and
  route checks: four passed; local Cloudflare worker: 13 passed with one hosted
  TCP check skipped. The local proof worker was stopped after verification.
- Production mobile audio: all 8 checks passed with zero page errors. The run
  covered a second-song switch, reload persistence without autoplay and Quick
  Play completing before a deliberately delayed listening-session response.
- Final lyric-studio browser: pasted synced LRC skipped tap timing, opened its
  preview, preserved exact text through editing and published without page errors;
  complete file import and partial-LRC repair also passed.
- Vercel production/preview environment inventory was inspected again without
  printing values: all four required settings exist in both environments and
  both Upstash credentials use sensitive storage.

Suite totals overlap; do not add separate focused runs to the core count as a
unique test total. Ignored machine-generated evidence lives under `.local/`.
The repository reports retain the reproducible conclusions.

## Redis rollout and remaining physical limits

The free `sakura-cache` database is in `eu-central-1`, near the observed `fra1`
Vercel functions. Production uses `sakura:public:v1` and preview uses
`sakura:preview:public:v1`. The adapter has a 75 ms command deadline, no retries,
a four-command concurrency limit and a 30-second outage cooldown. It falls back
to providers/local transformation on cache failure. See
[UPSTASH-CACHE.md](UPSTASH-CACHE.md).

Redis environment settings are configured, but the application changes have
not been deployed. Deployment-local API p50/p95/p99 and Redis hit latency remain
unmeasured. The earlier warm database round trip from this workstation was
320 ms median, so a universal 100 ms end-to-end promise is unsupported.

Cold provider search, full downloads, bcrypt, hosted transcription and video
encoding have separate completion costs. Cross-device resume keeps explicit
paused ownership behavior. Chromium device-change and iPhone-style fixtures do
not certify physical Bluetooth switching or iOS Safari behavior.
