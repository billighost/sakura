# Sakura performance continuation results — 13 November 2026

This consolidates the implementation authorized by
[PERFORMANCE-REVIEW-2026-11-12.md](PERFORMANCE-REVIEW-2026-11-12.md), including the
recovered work and subsequent integration corrections. The review baseline is
`5229fdb1484cea3282e9951f1905b6e3716e2bf4`. The final local production build is
`oWX42YGIBJUzL50pfEbrc`, served on `127.0.0.1:3117`. Its application source matches
the tested manifest; subsequent changes are browser-fixture/report corrections only.
No deployment, production migration or external configuration change is part of
this continuation.

The portable implementation is present and its completed local gates are recorded
below. Measurement-dependent architectural alternatives and remaining physical or
hosted qualification are explicitly retained. An implemented contract is not
evidence of deployed latency, a physical-device result or a universal startup
budget.

## Disposition of all 67 review items

**Implemented** means current source provides the stated behavior with local
regression coverage. **Partial** identifies implemented work and an unapplied
remainder. **Conditional** means the proposed change remains measurement-gated.
**Rejected after measurement** means the tested alternative did not establish a
benefit. Browser and database limits apply even to implemented rows.

| Review ID | Disposition | Current result and remaining scope |
| --- | --- | --- |
| O1 | Partial | Fixed-name ordinary SQL/lock stages, numeric pool counters, bounded client startup/bootstrap/restore/navigation/playback metrics, Web Vitals and opt-in long-task/worker diagnostics are present. API inventory covers 53 routes and 71 explicit methods. Current fixtures and production build provenance were repaired. Hosted percentiles, instrumentation overhead and the complete physical matrix remain unmeasured. |
| A1 | Implemented | Favorite confirmations write changed pairs only. Real-browser unchanged 1k/5k snapshots produce zero IndexedDB puts and mirror writes; one unlike produces three puts and two mirror writes. |
| A2 | Implemented | Account-scoped settings/favorites/taste/session flights coalesce triggers and coordinate tabs through Web Locks/BroadcastChannel. Request-start boundaries preserve the 15-second target, including delayed responses, early/duplicate timers and clock rollback. Focus uses ordinary refresh. Disposal and cancellation races are fenced; unavailable browser coordination falls back to safe independent reads. |
| A3 | Partial | Durable field/song watermarks and a listening monotonic floor compact acknowledged journals without reviving sleeping writers. A 100k reserved-order fixture hydrates with at most four journal visits. The point-read order ledger deliberately retains old operation identities: hydration scans are bounded, historical bytes are not fully eliminated. |
| A4 | Implemented | Safe remembered-account reads overlap authoritative bootstrap; state publishes only for the matching identity. Essential preferences/journals restore before optional taste and parked picks. The existing offline fallback timing and early-edit/account-generation fences remain. |
| A5 | Implemented | Version-two session transport validates bytes, preserves deliberate queue occurrence/card metadata and sends small checkpoints only against an acknowledged queue. Oversized keepalive choices remain durable for foreground retry; playback checkpoints do not renew deliberate ownership. |
| A6 | Conditional | Root/login authority is unchanged. Intercepted routing cannot safely isolate the root Server Component account read; distorted prefetch traces do not justify an authentication/routing change. |
| R1 / R2 / R3 | Implemented | Liked subscribes to and warms liked membership only; onboarding requests `kind=artists`; Top Songs warms `/api/v2/profile`. Artist-only provider selection uses two upstream calls instead of four in the same injected fixture. |
| R4 | Implemented | Visible resources, speculation, retries and paging own independent cancellable leases. The last owner retires transport; ignored-abort late replies cannot block or overwrite a replacement. Search paging resets when the query changes. Ordinary invalidation retains usable stale content; actual revocation still drops it. |
| R5 | Implemented | Collection presentation reads coalesce and reject stale replies; unchanged receipts avoid writes. Playlist/collection edits use one targeted invalidation rather than retry plus invalidation. |
| R6 | Rejected after measurement / conditional remainder | The production Search baseline already makes zero query/tab `/search` RSC requests; native history replacement also makes zero, so that substitution was rejected. Large indexed member-search architecture still requires mature-account measurement. |
| R7 | Implemented | The authoritative public card streams independently of the optional account-dependent action. Local React streaming fixtures cover slow/failing/deleted accounts and revoked shares; this is not a production RSC latency comparison. |
| U1 | Implemented | Immutable cards reuse normalized search text; canonical alias revisions invalidate projections. Cold indexing yields and cancels obsolete queries; deferred results retain membership identity and mixed-script/word/order parity. |
| U2 | Implemented | Download snapshots separate membership from byte progress and notify keyed consumers. Stable action/view contexts and memoized rows/projections prevent byte-only progress from publishing the broad membership view. Application commit/INP measurements remain part of browser qualification. |
| U3 | Implemented | Lyrics use narrow verse/word/timeline subscriptions and memoized rows/manuscript/validation. Ordinary drafts coalesce at 250 ms idle with a one-second maximum; precise taps and close/background flush immediately, and accepted publication cannot restore a deleted draft. |
| U4 | Implemented | Global gesture cancellation listeners exist only during an active hold; inactive rows perform no press-phase deletion. Cleanup preserves scroll, second-finger and keyboard behavior. |
| U5 | Implemented | Rendering and offline warmup share the lazy removal-dialog loader. Ordinary dialogs now import common primitives and a small stylesheet; listening rooms retain the original style mapping. Cold offline first-use removal verifies cached JavaScript/CSS, safe initial focus, cancellation and trigger-focus restoration. Current Home loads 38,899 fewer decoded CSS bytes than the preceding continuation build; combined source changes and machine load prevent an isolated startup-speed claim. |
| U6 | Conditional | Additional list containment/windowing, swipe transforms and popover frame scheduling remain unapplied pending profiling after subscription/search changes, with keyboard/find/focus/scroll-anchor gates. |
| D1 / D2 | Implemented | Negotiated DTO version three removes duplicated cards/arrays and uses membership cursor pages plus compact authoritative mutation receipts. Header-absent clients retain legacy envelopes; old saved resources normalize at the boundary. `/library/state` remains authoritative for revisions and unlike tombstones. |
| D3 | Partial | Initial feed and hero share one taste/evidence acquisition and card-hydration batch; the application populates both existing caches from that shared request. Standalone hero and cursor behavior remain. Mix reservoirs differ, so further feed/mix context reuse remains conditional on explicit snapshot/output parity. |
| D4 | Implemented | Exact ingestion batches identities/bindings/credits and avoids unchanged descriptive writes. The injected three-credit fixture changes from 17 statements/12 write attempts to 10/7; identical repeats use two reads and zero writes. The post-insert read remains for concurrent conflict visibility. Real PostgreSQL conflict/WAL measurements remain outstanding. |
| D5 | Partial | Read projections derive missing initial taste without UPDATE; explicit maintenance retains durable repair. Export has its own coherent read-only snapshot. Other exclusive history locks, pool size and transaction/CPU boundaries remain; shared-lock or revision-snapshot redesign requires concurrent privacy/erasure and wait/hold measurements. |
| D6 / D7 | Conditional | No timestamp-index/predicate migration, genre-aggregation rewrite or durable analytics summary/backfill was applied. Isolated PostgreSQL plans at 10k/100k/1m chunks, calendar/raw-oracle parity, write cost and erasure tests are still required. |
| D8 | Implemented | Negotiated taste synchronization selects the top 500 before hourly aggregation and omits unused feedback display cards. Profile/export evidence and deletion receipts remain complete; boundary movement and expired feedback have fixture coverage. |
| D9 | Implemented | Global catalog admission permits four active operations, at most two background operations and 128 waiting; foreground work precedes queued background work. Public enrichment shares cancellable flights; compatible snapshots allow early cooldown without SQL. Hosted fairness/contention remains unmeasured. |
| D10 | Partial: migration required | Ordered cancellable import workers and source-bound atomic replay receipts are implemented. The additive `ImportReceipt` schema change is prepared but unapplied; capability detection retains safe pre-migration behavior. Cheap durable receipt replay requires a reviewed migration application. |
| D11 | Implemented, database qualification pending | Export uses one read-only REPEATABLE READ snapshot and 128-row cursor batches without the exclusive account-history lock. Cancel/disconnect/failure/deadline closes the snapshot; commit precedes the final JSON byte. The browser saves the native Blob without JSON parse/pretty copies. Real snapshot/erasure, slow-reader and pool-contention tests remain; the complete file still occupies browser storage. |
| D12 | Partial / conditional remainder | Explicit personalization-export HEAD checks identity without opening a snapshot. Typed UUID source-proof comparison and further explicit HEAD changes remain measurement-gated; the existing proof checks and other method semantics remain. |
| C1 / C2 | Implemented, hosted benefit unmeasured | Public Redis SET moves out of scoped response completion through bounded lifecycle-owned writes; standalone work remains awaited. Validated versioned exact/ISRC projections reuse L2 across service instances. Private data/tokens/media are excluded, and the existing timeout/admission/circuit rules remain. Cold misses add a bounded GET; regional hit rate and net latency need hosted measurement. |
| C3 | Conditional | Public proof renewal and a durable migration identity index remain unapplied. No proof-expiry/private-eligibility rule was relaxed to improve saved-reading reuse. |
| P1 / P2 | Implemented | Next-song work follows shared connection/visibility/priority policy and explicit speculative ownership. Obsolete speculation releases without cancelling explicit saves or demoting completed files. The actual next occurrence is reserved under existing shuffle/manual/repeat rules and reused without rerolling; preparation is independent of recommendation refill. |
| P3 | Implemented | Exact collection indexing retains all candidates, deduplicates identical expected identities and batches canonical publication. At most 50 references/32,768 UTF-8 bytes enter one request; 2k references use 40 requests rather than one request per track. Cancellation and whole-response validation precede publication. |
| P4 | Partial | Metadata-first local hydration removes eager full-library Blob/chunk loading. Direct verified-source versus progressive playback selection remains conditional on current SW/storage/audible-output measurements and recovery parity. |
| P5 | Implemented | One-pass exact DSP/waveform analysis runs in a bounded cancellable module worker with a small immutable-source result cache and yielding fallback. Native OfflineAudioContext still renders sound filters; generated-PCM parity and scheduling responsiveness are verified. |
| P6 / M3 | Partial | Preview/share prefer exact attached/current or verified local audio and perform working-PCM preflight. Decoded artwork retention has entry/byte budgets; known square export covers request appropriate bitmap dimensions with safe fallback. Clip-aware demux/decode is not enabled. Native whole-file decode remains uncancelable and may allocate before postdecode validation; these forecasts are not measured hard browser RSS caps. |
| P7 | Partial | Empty autoplay has generation-specific 2/4/8/16-second backoff, reset by relevant new choices/reconnect. Durable/windowed runtime-queue redesign remains conditional; no chosen future occurrence is discarded. |
| F1 | Implemented | Controlled resource responses return promptly while lifetime-owned cache writes stream in the background. Shared flights remain owned; document publication still awaits every critical dependency for offline atomicity. |
| F2 | Implemented | Listening drain scans account/listen key ranges in bounded fair batches, with durable scan progress; account erasure uses an account range. Foreign audio/chunks no longer enter a target listening scan. |
| F3 | Implemented | Ready metadata indexes and stable account projections avoid Blob enumeration after compatible backfill. Download hydration uses map lookups; selected/resumed jobs load chunk handles lazily. Finalize/promote/remove update metadata atomically and invalidate cross-tab projections. Legacy files remain readable. |
| F4 | Implemented, budget limits qualified | Service-worker manifests protect cached-document dependencies and known open old builds. Asset/art/document entry/byte/age budgets, retirement and bounded quota recovery are present. Protected dependencies or unknown open-client manifests can exceed targets intentionally; explicit saved audio is preserved. |
| F5 | Implemented portable subset | Local audio manifest/chunk reads share one coherent transaction. Immutable Blob hash flights reuse identity; replacements/deserialized Blobs require fresh verification. No persistent SW verification cache skips fresh integrity checks. |
| F6 | Conditional | Storage splitting remains unapplied pending measured metadata/chunk transaction contention and an atomic compatible upgrade design. |
| L1 | Implemented, active ownership qualified | Persistent hits use the same 128-entry/eight-MiB lyric insertion path; owned generation objects prevent stale negative/publication/write resurrection and retire when unused. Live owners may temporarily exceed retention targets; durable lyric storage remains. |
| L2 / L3 / L4 | Implemented | Lyric/reading callers own independent end-to-end leases; the last owner aborts upstream work. Language engines import lazily after cache misses, with coalesced initialization and bounded yielding transforms. Error streams are discarded and successful provider JSON is byte/deadline bounded. |
| L5 | Implemented | One eligible preferred-reading prefetch follows the actual next-song identity through the visible player's shared cache, preference and connection/audio priority gates; disabled preferences start no reading work. |
| L6 | Implemented | Validated Auto Sync cooldown precedes provider work. Compact phase/retry hints drive adaptive visible polling and hidden/resume behavior while preserving durable accepted-job authorization/recovery. Real hosted model/queue latency is unmeasured. |
| B1 | Implemented | Exact deterministic opening samples prepare in one bounded worker/cooperative queue with retained byte limits and independent owners. Gesture-bound AudioContext resume and authored score remain. Native convolution/graph construction still has material synchronous costs. |
| B2 / B3 / B4 | Implemented | Display/preparation/warmups share concrete native artwork variants, including metadata-only legacy covers and saved offline DPR variants. World/audio/artwork interleave under three owners while every required soundtrack file still gates Enter. One authoritative `GET ?prepare=1` removes the serial preparation POST. |
| B5 | Conditional | Existing automatic selection, all five manual tiers, authored visuals and reduced motion remain. Post-mount adaptation needs sustained all-world/physical GPU evidence and safe transition hysteresis. |
| B6 | Implemented | Fonts/frames/FileReader/final decode/PNG waits are bounded and owned; closing releases roots, handlers, image sources and canvas resources. The final SVG data URL remains because the measured Blob URL alternative tainted Chromium canvas readback. |
| B7 | Implemented, scale benefit unmeasured | Matching immutable snapshots negotiate compact sequential disclosure receipts; mismatched/legacy consumers receive the full recap. Prefix/scope/completion fences reconstruct only trusted prepared facts. Fixture bytes shrink; mature yearly-story request percentiles remain unmeasured. |
| M1 | Implemented | Artwork admits four active/64 queued unique transfers, shares queued identities and cancels on last-owner release. Queue time counts toward the existing deadline; overflow rejects before upstream work. The 80-identity fixture peaks at four instead of 81 active starts. |
| M2 | Implemented | Link identity follows its exact payload rather than raster layout. Track links avoid irrelevant lyric work; Link preview starts no PNG raster preparation. Source/account changes cancel owned preparation and native share retains its user gesture. |
| W1 | Partial | Source assembly uses one exact-sized buffer; upload avoids an extra concatenation, and complete CDN verification hashes streams without retaining a second full file. Full checksum/tag/container inspection remains. File-backed spooling is unapplied pending deployment/storage/cleanup measurement; whole source inspection and Blob upload still allocate substantially. |
| W2 | Implemented | Failures share a 1k-entry eviction bound. Registration/share JSON uses bounded streaming reads and finite waits; rate admission retains existing limits. Negotiated compact pending jobs omit repeated cards and validate identity; foreground polling remains within one second, with longer hints only for explicit background work. |
| W3 | Partial: instrumentation only | Numeric opt-in worker packet/storage/alarm/session/admission diagnostics are present. Packet ownership fences, chat serialization, drain timing and the two-transfer Cloudflare limit remain. No throughput coalescing, new Telegram session or hosted/infrastructure change was justified or performed. |

## Completed integration gates and observed results

The integration repaired feed/hero cache participation, account refresh timing and
focus handling, playback journey markers, Windows `ClientDiagnostics` filename
casing, Bloom fixture dates/types and current API fixtures. The default test runner
now includes 23 additional regression suites rather than leaving them as manual
commands.

The final qualification also closed six integration defects found only under real
production/offline sequencing:

- paused or offline queue reordering now remains the download priority on reconnect;
- file-input cancellation no longer dismisses the enclosing player dialog;
- the mobile Lyric Studio close control remains visible inside the listening room;
- Bloom's lazy renderer is warmed through the same Turbopack import site used for
  rendering, so retained stories can reopen offline;
- Bloom preparation pins now use reload-stable, tab-specific owners plus an
  account-scoped interrupted-cleanup journal, preserving other tabs and Saved audio
  while history erasure removes only the current document's obsolete pins; and
- lazy player/lyrics/queue/removal warmup now waits for the service worker to
  acknowledge durable CacheStorage writes, eliminating the cold-offline race where
  an import resolved before all of its static chunks were actually saved.

| Gate | Recorded result |
| --- | --- |
| Default `npm test` | The latest completed full run passed 1,134/1,134 checks across seven TAP groups. The forbidden credentialed product fixture is not part of this command. A final duplicate run was omitted at the user's request before push. |
| Focused continuation regressions | 310/310 passed before the final PWA correction; the changed PWA/navigation scope then passed 35/35. Bloom listening synchronization passed 31/31, including the explicit 15-second passive-sync regression. |
| Bloom pin lifecycle | Playback integration 179/179; download engine plus audio preparation 97/97. |
| Mocked Node worker gate | 60 passed. |
| Cloudflare worker gate | 14 passed; one hosted check skipped. Local proof worker used port 8788 with Telegram startup disabled. |
| API inventory | 53 routes, 71 explicit methods, no untimed method. |
| Standalone TypeScript and production build | Passed; final browser build ID is `oWX42YGIBJUzL50pfEbrc`. The duplicate alternate-directory build was omitted at the user's request before push. |
| Full lint | The latest completed full run passed with zero errors and 23 warnings. Scoped final-change lint is zero errors and zero warnings; a final duplicate full run was omitted at the user's request before push. |
| Real account storage/tab fixture | Unchanged 1k/5k favorites: zero puts/zero mirror writes. One unlike: three/two. Three tabs: one shared request per 15-second period, including recovery after the first tab closes; zero page errors. |

Separate suites overlap and must not be summed into a unique total. The accidental
credentialed product fixture below is excluded from the approved validation count.
Browser fixtures use generated media and intercepted APIs, not real provider audio
or account projections.

Current Home feed-ready elapsed samples used three cold and three warm navigations
at each browser CPU setting, with intercepted APIs and service workers blocked.
Elapsed time is measured from the browser navigation time origin. These are small
local automation distributions, not deployed percentiles; there is no matched
baseline startup speedup claim. With three samples, the reported p95 is the largest
observation.

| Browser CPU setting | Cold feed ready p50 / p95 | Warm feed ready p50 / p95 |
| --- | ---: | ---: |
| 1x | 1,862.4 / 2,633.1 ms | 1,538.8 / 1,809.3 ms |
| 4x | 3,673.3 / 3,771.4 ms | 2,073.2 / 2,303.2 ms |

Useful subsystem comparisons remain narrower than end-to-end loading: the actual
mocked Library envelope shrinks from 189,242 JSON bytes to 36,467 (10,248 to 2,055
gzip bytes); unchanged ingestion removes all write attempts; scoped Redis responses
complete while SET is blocked. Two simultaneous generated 120-MiB promotions show
sampled ArrayBuffer growth of 960.0 MiB before versus 551.5 MiB currently, with one
sample per mode. DSP fixtures demonstrate worker scheduling and original-result
reuse; DevTools worker throttling is insufficient for a physical-device speedup
claim. Opening sample reuse is effectively immediate in the fixture, but cold
native graph construction remains about 107 ms in the separate sample report.

Selected before/after measurements from the subsystem reports are summarized
below. Percentages are calculated from the recorded local fixtures, not hosted
service percentiles.

| Measured surface | Before | Current | Change |
| --- | ---: | ---: | ---: |
| Home JavaScript payload | 335,713 bytes | 292,338 bytes | 12.9% smaller |
| Home CSS payload | 67,626 bytes | 52,344 bytes | 22.6% smaller |
| Small Deezer thumbnail transfer | 76,244 bytes | 2,978 bytes | 96.1% smaller |
| Bloom 20-chapter entry artwork requests | 20 | 3 | 85.0% fewer |
| Bloom settled animations | 164 | 95 | 42.1% fewer |
| Library DTO JSON / gzip | 189,242 / 10,248 bytes | 36,467 / 2,055 bytes | 80.7% / 80.0% smaller |
| Three-credit ingestion statements / write attempts | 17 / 12 | 10 / 7 | about 41% fewer |
| Two concurrent generated 120-MiB promotions, sampled ArrayBuffer growth | 960.0 MiB | 551.5 MiB | 42.6% lower |
| Artwork burst maximum active starts | 81 | 4 | 95.1% lower |
| Exact indexing for 2,000 tracks | 2,000 requests | 40 batches | 98.0% fewer; 50× reduction |
| 100-row playback / four-download row changes | 100 / 100 | at most 1 / 5 | 99% / 95% fewer changed rows |
| Normal-CPU audio analysis median | 610.4 ms main-thread baseline | 563.3 ms worker; 281.7 ms cached | 7.7% / 53.9% lower elapsed, with timer responsiveness restored |
| Prepared video export, 5 s / 8 s / 12 s sample | 2,613.7 / 3,621.0 / 3,104.3 ms | 1,671.3 / 3,037.6 / 3,503.9 ms | 36.1% faster / 16.1% faster / 12.9% slower |

The video result is intentionally reported as mixed rather than a universal export
speedup. Its consistent wins are near-immediate first progress, no duplicate audio
request and no repeated card paints. Worker audio also demonstrates responsiveness,
not merely total CPU reduction: the old loop allowed no 10-ms timer callbacks while
worker runs allowed 55–61. The 1,000-row collection still records a 575-ms
input-to-next-frame p95, so U6 virtualization remains evidence-gated.

## Final production browser record

The production routing review passes: query/tab changes and the native-history
comparison all make zero route requests; the replacement query starts one paging
request before the abandoned page is released; onboarding requests artists only;
there are zero page errors.

The final serial 100-row and 1,000-row collection runs both pass mixed-script
search, IME, sorting, keyboard options, hold cleanup, scroll stability and mobile
width checks with zero page errors. Docking the search field preserves its original
layout slot; both runs record zero scroll adjustment. Each playback update changes
at most one row, and four concurrent downloads change at most five. The fixture
checks the removal of each owned hold listener rather than unrelated global totals.
Earlier failed reports remain available for comparison.

| Final collection fixture | 100 rows | 1,000 rows |
| --- | ---: | ---: |
| Cold playlist visible | 1,757.5 ms | 4,175.4 ms |
| Input-to-next-frame p95, 13 samples | 64.3 ms | 575.0 ms |
| Mounted DOM elements | 12,214 | 111,214 |
| Maximum rows changed per playback / four-download commit | 1 / 5 | 1 / 5 |
| Maximum scroll adjustment | 0 px | 0 px |

These single-run local proxy measurements include harness and host costs. The
1,000-row observations do not establish the proposed interaction or scrolling
budgets and retain the U6 measurement gate. The earlier 100-row baseline changed
all 100 rows per playback/download commit; its later hold check failed, so only the
recorded count comparison is used. The baseline 1,000-row run failed to start
playback. No matched startup/input latency speedup is claimed. Evidence:
`.local/collection-performance-final-100.json`,
`.local/collection-performance-final-1000.json` and
`.local/collection-performance-baseline-100.json`.

The following gates were rerun serially against final build
`oWX42YGIBJUzL50pfEbrc`. Generated media and intercepted synthetic APIs were used;
there were no provider, account-database or Telegram sessions.

| Final-build browser gate | Result | Primary evidence |
| --- | --- | --- |
| Connection/download recovery | Passed 13 checks, zero page errors; offline queue priority, cross-tab cancellation/retry, pre-metadata seek, retained prefix and exact reconnect recovery all held. | `.local/connection-integration-browser-report.json` |
| Playback startup | Passed 6 scenarios, zero page errors and zero database writes. | `.local/playback-startup-browser-chrome-wav-report.json` |
| Lyrics and player interactions | Passed desktop and 390-px runs, four comprehensive checks and zero errors, including the nested mobile Lyric Studio close control. | `.local/lyrics-interactions-browser/report.json` |
| Production audio preview | Passed 4 checks on the exact final build; worker/context cancellation and generated-device-file replacement released their resources. | `.local/audio-preview-production-browser/report.json` |
| Share lifecycle | Passed 4 checks with no unexpected API traffic. | `.local/share-performance-browser/report.json` |
| Auto Sync | Passed 5 checks, including search, background/resume polling and accepted job recovery. | `.local/auto-sync-browser/report.json` |
| Lyric publish | Passed Chrome and WebKit flows, including bounded proof expiry and a responsive proof worker. | `.local/lyric-publish/report.json` |
| PWA/offline navigation | Passed 12 cold/offline checks with zero page errors after the lazy-chunk durability acknowledgement. | `.local/pwa-offline-browser-report.json` |
| Loading/offline first use | Passed 5 checks: durable modal warming, neutral-shell deep link, saved playback and first-use modal/removal flows. | `.local/loading-offline/report.json` |
| Bloom staging | Passed 3 checks with zero errors, including delayed commits, retry and cancellation. | `.local/bloom-staging/report.json` |
| Bloom readiness and erasure | Passed 7 checks with zero errors; offline reload restored unseen artwork, and erasure removed the preparation plus every owned audio pin. Prepared Enter was 22.6 ms in this run. | `.local/bloom-readiness/report.json` |
| Offline storage comparison | Passed the shared-store/separate-store benchmark at 64-KiB and 256-KiB chunks. | `.local/audit-offline-storage-browser.json` |
| Native product export | Passed with zero errors. | `.local/product-export-current.json` |
| Bloom all-world/tier/motion performance | Passed 120/120 journeys with zero errors: 50 explicit-tier plus 10 adaptive journeys, repeated under reduced motion. | Four `.local/bloom-performance/after-chromium-matrix*-report.json` reports |
| Bloom export and cancellation | Targeted 320-px export passed with zero clipping/errors, and the lifecycle suite passed 9/9. The duplicate full 82-export browser matrix was stopped at the user's request before completion. | `.local/bloom-export-review/after/report.json` and the lifecycle test output |

The build-ID journal for these fixtures is
`.local/continuation-required-browser-journal.json`; Bloom's separate matrix journal
is `.local/continuation-final-bloom-journal.json`. Historical browser figures in
`PERFORMANCE-RESULTS.md` describe the preceding pass and are not substituted for
final-build evidence.

## Credentialed fixture incident

An earlier continuation batch mistakenly executed
`scripts/rebuild-product.test.ts`. It loads configured database credentials despite
its unsuffixed filename and created an isolated fixture schema plus two synthetic
accounts. This was outside the authorized database scope. Its cleanup awaited the
exclusive schema DROP and guarded synthetic-account DELETE; the exact ignored
journal `.local/product-db-fixture-ef9609e184a145799d39d08196231c7c.json` records
`status: "cleaned"`. No further database work was used to fill measurement gaps.
This run is not an approved database baseline, a migration rehearsal or evidence
of production query/lock behavior. Future safe runs must inspect imports and pool
injection rather than infer safety from test filenames.

## Handoff and limits

Final matrix result: 120/120 Bloom performance journeys passed with zero errors;
the targeted export and 9/9 lifecycle checks passed, while the duplicate full
82-export rerun was stopped at the user's request. The latest completed static gates
include 1,134/1,134 default-test checks, clean TypeScript and production build,
zero lint errors, the 53-route/71-method API inventory and a clean final diff check.
The recorded production application source matches build `oWX42YGIBJUzL50pfEbrc`;
duplicate final lint/test/alternate-build runs were omitted at the user's request.
Required future database work needs an explicitly disposable, authorized PostgreSQL
environment: plans/cardinalities, conflict and snapshot/erasure concurrency,
lock/pool pressure, index/WAL costs and the import-receipt migration rehearsal. No
local PostgreSQL/Docker executable was available for that baseline. Shared-lock
changes, durable summaries, proof casts, storage splitting, virtualization, clip
decoding and file-backed spooling remain evidence-dependent.

Physical Android/iOS Safari, audio/Bluetooth latency, sustained GPU/thermal world
performance, codec/encoding allocation, live Redis/provider latency and hosted
worker throughput remain unqualified. Windows WebKit lacking Web Audio does not
qualify an iPhone. No real audio acquisition or new Telegram session was used.
Keep Saved behavior, the 15-second passive target, existing offline fallback timing,
complete Bloom readiness, audio integrity and all privacy/erasure/occurrence fences.

Mesh persistent context is unavailable because the local store schema is version
six while the installed CLI supports version three. This report and the subsystem
documents provide the handoff; no memory records were invented.

Supporting records:
[account](PERFORMANCE-ACCOUNT-CONTINUATION.md),
[database/cache](PERFORMANCE-DATABASE-CACHE-COMPARISON.md),
[product/import/export](PERFORMANCE-PRODUCT-2026-11-12.md),
[media bounds](PERFORMANCE-MEDIA-BOUNDS.md),
[audio](PERFORMANCE-AUDIO-2026-11-12.md),
[routing/resources](ROUTING-RESOURCE-VERIFICATION.md),
[Bloom integration](PERFORMANCE-BLOOM-INTEGRATION.md),
[opening samples](PERFORMANCE-BLOOM-OPENING-SAMPLES.md) and
[poster lifecycle](PERFORMANCE-BLOOM-EXPORT-LIFECYCLE.md).
