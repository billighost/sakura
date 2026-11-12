# Sakura performance plan — 11 November 2026

## Objective and scope

Make the application respond immediately wherever local data or preparation can remove waiting. Review all **50 Next API routes / 67 exported HTTP methods**, all music navigation, account synchronization, audio delivery, Bloom preparation, lyrics, images, video sharing, and the Node/Cloudflare/hosted lyric workers. Give every endpoint an explicit budget and verification path; do not weaken identity, account isolation, password security, offline durability, or exactly-once listening receipts to achieve a timing number.

The implementation strategy is to extend the existing local caches, journals, download scheduler and server services. A wholesale rewrite would discard substantial tested behavior without evidence that a different framework fixes the measured bottlenecks. Architectural changes will instead remove blocking analytics from startup, separate preparation from interaction, share work, reduce SQL/provider round trips, and control speculative bandwidth.

## Baselines and expected results

Numbers below distinguish observed measurements, historical observations, and targets. A target is not a delivered result. API handler duration excludes browser RTT, Next routing overhead and streamed body transfer; interaction latency includes the user-visible result.

| Observation | Evidence | Implication |
| --- | --- | --- |
| Current remote DB probe: cold 6,192–6,530 ms; warm 170/361/257/341/320/534/271 ms, median 320 ms | 11 Nov 2026 21:22:47 UTC; three concurrent then seven serial `SELECT 1` queries, no account data | Even one DB round trip currently exceeds 100 ms from this machine. This is a development-to-DB measurement, not a deployed API benchmark. |
| First feed ordering: 486–986 ms for 2,500 synthetic candidates; 33–60 ms for 600 | Read-only audit of production personalization functions | Quadratic sequencing blocks Node and holds the account history lock; optimize exact ordering and benchmark equivalent output. |
| Japanese readings: cold dictionary 1,020.92 ms; subsequent 54.97/42.47/46.21 ms for 80 synthetic lines | Production `romanizeLyricLines`, compute only | Cache transformations and prepare preferred readings before the player needs them. |
| Bcrypt cost 12: hashes 425/504/476 ms; comparisons 433/498/710 ms | Synthetic credentials, compute only | Login/registration cannot complete in 100 ms at the existing security cost; preserve that cost. |
| Historical warm resolve 863–973 ms; cold resolve 1.392–3.913 s | `LIVE-HTTP-AUDIO-CHECK.json`, 7 Nov | Eliminate repeated asset reads and compatible remote signing; prewarm destination audio. |
| Historical signed-worker first 4 KiB 1.398–2.233 s; gateway 1.958–3.543 s; full files 14.9–19.8 s | `LIVE-SOURCE-TIMING.json`, 7 Nov | Remote media acquisition must happen before use where possible; full transfer cannot be promised in 100 ms. |
| Bloom preparation starts after Enter and music loads per chapter | `useBloomDirector.ts`, `useBloomAudio.ts` | Add a manifest and local verification gate before the story becomes enterable. |
| Video duplicates its ready artwork render, downloads and decodes a full song, then encodes a short clip | `ShareDialog.tsx`, `shareRender.ts` | Reuse artwork, local verified audio and prepared codec/audio inputs. |

| Interaction/API class | Expected improvement to validate | Budget / practical limit |
| --- | --- | --- |
| Previously visited / deliberately prefetched pages | Remove foreground data request; cached feedback within one frame to 100 ms | Click → meaningful content p95 ≤100 ms; saved IndexedDB view ≤150 ms after account verification |
| Existing-device startup | Remove full profile analytics and taste synchronization from blocking boot; aim for ≥60% less blocking work | Measure cold/warm click → usable shell; DB/auth still applies |
| Feed ordering | Aim for ≥80% reduction in the measured large-reservoir CPU cost, preserving order and pagination | Ordering target ≤100 ms for 2,500 ordinary candidates; report adversarial cases |
| Private prepared API reads | Reduce repeated SQL, card payloads and locks; pursue 2–5× reduction where current paths have many serial reads | Server p95 ≤100 ms only where compute and DB locality permit; current topology is measured separately |
| Like / queue / preferences / playlist changes | Reuse optimistic state and compact receipts; avoid unrelated reloads | Visible acknowledgement ≤50 ms; durable commit measured separately |
| Already downloaded audio | Remove resolver/network work from playback start; prepare before source replacement | UI ≤50 ms; first audible output target 100–250 ms, subject to browser decoding/output |
| Cross-device resume | Hydrate session promptly and prepare its current/next audio; avoid waiting for analytics | Prompt usable resume control; preserve explicit paused ownership behavior |
| Bluetooth/headphone changes | Recover existing graph/source; retain playback position | Measure continuity independently; physical OS/browser transitions cannot be guaranteed by API changes |
| Bloom | Finish required story JSON, selected soundtrack files, intro and artwork before Enter is enabled | Verified readiness invariant; no new music acquisition on chapter transitions; response ≤100 ms after ready |
| Repeated reading transforms | Eliminate repeated dictionary work | Cache-hit transform target <5 ms, excluding auth/network |
| Prepared video sharing | Remove duplicate artwork work and local-audio download; prepare codec/audio concurrently | Start/progress ≤100 ms; total encoding remains device/clip dependent; measure 5/8/12-second clips |
| Cold search, ingestion, imports, transcription, full video export | Dedupe/bound preparation; show progress and retain useful existing content | Measure completion separately; no universal 100 ms claim |

Gains are estimates based on specific removed work. Final reporting must replace them with measurements where fixtures or deployment access allow. Do not multiply an estimated speedup by an unrelated historical latency.

## Implementation passes

### 1. Measurement and endpoint coverage

- Add lightweight response timing to every explicitly exported application API method, including auth and media, and stage timing to shared auth/transaction paths. Preserve stream bodies, cache headers, cookies, status codes and byte validation.
- Keep telemetry free of user IDs, query text, song/lyric text, credentials, tokens and signed URLs. Use static route templates and numeric timing/counts only.
- Maintain a generated inventory so new routes cannot silently miss timing coverage. Benchmark production builds; development compilation is not an API baseline.
- Capture cold/warm p50/p95/p99, handler duration, time to first byte, external requests, transferred bytes, failures and click → usable/audible outcome. Never count authored animation duration as network waiting.

### 2. Startup and account APIs

- Add a lightweight authenticated identity/bootstrap response; do not fetch full listening analytics merely to establish the account.
- Parallelize independent local hydration; release the usable shell after account-safe local state is ready. Reconcile taste, settings and favorites in the background with generation fences.
- Replace paginated library traversal for favorite synchronization with a compact state/revision projection. Preserve favorite tombstones, operation receipts and conflict reconciliation.
- Use compact mutation responses only where all consumers understand the new contract; otherwise optimize server reads without changing the response shape.
- Keep fresh account existence checks and signed auth. Do not cache account deletion away. Preserve session compare-and-swap, offline preference journals and explicit playback ownership.
- Consolidate consistent projections and repeated reads; keep erasure/history lock correctness. Change lock architecture only after concurrency tests demonstrate retained semantics.

### 3. Catalog, recommendations and imports

- Replace quadratic full-feed ordering with an equivalent bounded/grouped selection algorithm. Validate randomized equivalence, ties, repeated artists, genre penalties, duplicates and stable pagination.
- Reuse request-scoped settings/taste evidence; avoid repeated projections while holding the history lock. Batch hydration where SQL behavior can stay identical.
- Coalesce cold public provider requests and token refresh, with bounded success caches, failure eviction and independent consumer cancellation.
- Parallelize independent artist detail/top-track/album requests. Keep exact recording identity and a complete provider discography; local indexed membership is not a complete replacement.
- Prepare refreshes before expiry and avoid long external catalog preparation on normal navigation. Preserve durable completion or existing background `after()` behavior; do not fire unawaited work that serverless execution can discard.
- Optimize identical import previews and token reuse; bound matching concurrency. Large durable job redesign requires its own tested lifecycle rather than returning a premature success.

### 4. Frontend prefetch and rendering

- Warm route shells and their actual data caches on pointer/focus/touch intent. Home/Discover/hero loaders must write the same caches consumed by their visible components.
- Reuse canonical account-scoped resource keys and shared flights. Prefetch first pages and exact selected entities; keep cursor pages demand driven.
- Use a bounded scheduler: active audio/interaction, imminent navigation, Bloom preparation, then idle likely navigation. Pause speculative work while hidden, offline, saving data, on a slow connection, or during audio startup/buffering.
- Cancel queued work on account changes and reject stale completions. Use mutation-specific resource invalidation; history erasure retains its broader authoritative reset.
- Memoize collection normalization/filtering/sorting by actual collection inputs. Avoid rerunning large transforms on playback clock updates; profile before choosing a broader clock/context split or virtualization.

### 5. Audio and worker delivery

- Carry a verified selected asset through resolver, preparation and target decoration rather than reading it repeatedly.
- Mint document-bound v2 signatures locally only when the configured worker contract and locator evidence support the same HMAC verification; retain legacy fallback and HTTPS/origin/scope/document/expiry checks.
- Prepare the destination before replacing the active source. Preserve pause, cancellation, account epoch and retry position; a stale request must never take over playback.
- Warm the chunk containing a resume position. Reuse complete verified local blobs and existing queue prewarming.
- Add Promise-returning full asset preparation and automatic-cache leases for Bloom. Share existing priority/concurrency limits; do not create an independent bulk downloader.
- Recover the existing audio graph on supported device changes without forcing playback after a deliberate pause. Validate physical devices separately.
- Review all Node/Cloudflare health/capability/resolve/info/sign/stream routes. Keep metadata-only HEAD and stream verification; measure foreground contention and remote calls before further changes.

### 6. Bloom preparation before entry

- Preserve calendar availability and private chapter concealment. A truthful final recap cannot be frozen before the period ends; current likely songs can be warmed beforehand, then the final manifest is prepared at availability.
- Build readiness keyed by account + immutable story/snapshot + source revisions. Required JSON, assigned world assets, opening audio, soundtrack blobs and artwork must be loaded and validated before Enter is enabled.
- Progress and retry must be truthful. Missing tracks, quota limits or offline errors keep readiness pending/failed rather than silently unlocking a story with unavailable music.
- Pin automatic files during preparation and story use; release leases on completion/cancellation/account change. Respect current 48 MiB / 12-song automatic cache limits and make required capacity decisions explicit.
- Consolidate prepare/reveal/complete transactions and redundant reads; keep history/story lock order, exactly-once chapter reveal and completion behavior.
- Batch shelf readiness queries, reuse immutable snapshots and cache bounded calendar formatters. Preserve public chapter count contracts.
- Preload only worlds needed by the manifest and parallelize/dedupe poster artwork loading. Existing 7.6-second intro and 950 ms entrance are intentional animation, separate from readiness latency.

### 7. Lyrics, images and sharing

- Reuse a canonical lyric identity across retrieval/share/sync verification; preserve exact edition/artists/duration and preferred synced lyrics.
- Add bounded text/engine-keyed reading transformation caches; merge each caller's original timing fields. Prepare next-track lyrics/readings through existing offline caches.
- Cache/coalesce validated artwork bytes and ETags so repeat/304 responses do not reread/hash full upstream images. Retain host, redirect, MIME and size checks.
- Retain the prepared share canvas/PNG; coalesce codec probes; prepare audio and codec independently on video intent. Reuse account-owned checksum-verified local audio and key every cached export by source, text, timing, start position, duration, theme and dimensions.
- Bound decoded audio memory and cancel preparation on dialog/account/source changes. Preserve the separate final native-share gesture required by mobile browsers.
- Keep challenge/publish/transcription work authenticated and asynchronous where supported. Never speculate proof challenges, retry accepted uploads, or claim inference is a 100 ms operation.

### 8. Integration, repeat measurement and rollout

- Run existing core, server, synchronization, recommendation, download/audio, lyrics, resource/PWA and Bloom tests; add behavioral tests for new races/invariants rather than implementation mirrors.
- Use generated/synthetic audio and browser fixtures to measure playback/exports and avoid changing real personal data. Live metadata/database checks remain read-only and bounded.
- Run production TypeScript/build/lint checks, then focused browser flows for startup, navigation while playing, large collections, two-device state, Bloom preparation/entry, offline recovery, and video export.
- Review cross-agent diffs, rerun checks after integration fixes, and document measured results and remaining infrastructure limits.
- Prepare local changes for review. Hosting/database-region changes, migrations or worker deployment are separate concrete rollout steps; do not claim live improvements from local code.

## Complete Next API checklist

Budgets: **P** = prepared private response, pursue ≤100 ms handler with nearby DB; **C** = cached public metadata/transform, pursue ≤100 ms total where edge/runtime allows; **M** = immediate optimistic UI, durable mutation separately measured; **E** = external/cold work, progressive or prepared outcome and separate completion budget; **A** = verified stream metadata/first-byte/body measured separately. All methods receive instrumentation and regression coverage even if their secure contract is retained.

| Route | Methods | Budget | Planned attention |
| --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | GET, POST | E | Signed auth/password cost retained, fast post-auth boot |
| `/api/auth/register` | POST | E | Immediate feedback, secure password hashing retained |
| `/api/v2/albums` | GET | C | Bounded public listing projection |
| `/api/v2/albums/[id]` | GET | P/E | Complete provider snapshots, intent prefetch, fewer writes |
| `/api/v2/artists` | GET | C | Reuse verified aggregate metadata |
| `/api/v2/artists/[id]` | GET | P/E | Parallel provider details, complete cached discography |
| `/api/v2/audio-preview` | GET | A | Metadata first; avoid unnecessary WAV reads |
| `/api/v2/bloom` | GET | P | Reuse period data/snapshots; calendar optimization |
| `/api/v2/bloom/archive` | GET | P | Batched archive projections and intent prefetch |
| `/api/v2/bloom/shelf` | GET | P | Batch available-period checks |
| `/api/v2/bloom/[id]` | GET | P | Immutable snapshot reuse and private data prefetch |
| `/api/v2/bloom/[id]/prepare` | POST | P/E | One transaction; manifest and verified local readiness |
| `/api/v2/bloom/[id]/reveal` | POST | M | Idempotent reveal, reduced reads and writes |
| `/api/v2/bloom/[id]/complete` | POST | M | Idempotent completion, reduced reads and writes |
| `/api/v2/catalog/[kind]/[id]` | GET | C/E | Provider coalescing and parallel independent reads |
| `/api/v2/collection-view` | GET, PATCH | P/M | Compact indexed view state; local feedback |
| `/api/v2/feed` | GET | P/E | Exact faster sequencing, shared evidence, prepared first page |
| `/api/v2/feed/hero` | GET | P | Same-cache prefetch and evidence reuse |
| `/api/v2/history` | GET, POST | P/M | Indexed paging, exactly-once receipts, reduced lock work |
| `/api/v2/home` | GET | P | Prepared feed/mix/Bloom summaries and fewer projections |
| `/api/v2/image` | GET | C/E | Validated bytes/ETag cache and coalescing |
| `/api/v2/import` | POST | E | Preview coalescing/token reuse/bounded matching |
| `/api/v2/library` | GET, POST, DELETE | P/M | Compact favorite synchronization; preserve revisions |
| `/api/v2/listening-session` | GET, PUT | P/M | Foreground resume priority, lightweight state, CAS retained |
| `/api/v2/lyrics` | GET | C/E | Existing cache, canonical identity, next-track prefetch |
| `/api/v2/lyrics/challenge` | POST | E | Verified canonical input, no speculative challenge creation |
| `/api/v2/lyrics/publish` | POST | E | Accepted-upload acknowledgement/readback review |
| `/api/v2/lyrics/sync` | POST | E | Prompt pending UI, cheap polling, inference separate |
| `/api/v2/mixes` | GET, POST | P/E | Prepared summaries and bounded refresh critical path |
| `/api/v2/mixes/[id]` | GET | P | Projection reuse and exact intent prefetch |
| `/api/v2/mixes/offline` | POST | P/M | Local existing planner; batch server evidence |
| `/api/v2/onboarding/preview` | POST | P/E | Identical-preview dedupe and catalog projection |
| `/api/v2/personalization/data` | GET, DELETE | E/M | Consistent export, authoritative erasure, audio priority |
| `/api/v2/playlists` | GET, POST | P/M | Count/artwork projection and targeted invalidation |
| `/api/v2/playlists/[id]` | GET, PATCH, DELETE | P/M | Membership hydration, compact edits where compatible |
| `/api/v2/playlists/[id]/tracks` | POST, DELETE | M | Revision receipts and targeted local updates |
| `/api/v2/profile` | GET, PATCH | P/M | Remove analytics from boot, reduce edit follow-up work |
| `/api/v2/readings` | POST | C/E | Text-derived result cache preserving caller timings |
| `/api/v2/recordings/index` | POST | P/E | Exact metadata/ingestion sharing, identity checks |
| `/api/v2/recordings/resolve` | POST | P/E | Verified asset reuse and compatible local signing |
| `/api/v2/recordings/jobs/[jobId]` | GET | P | Account-scoped cheap polling/ready evidence |
| `/api/v2/recordings/[recordingId]` | GET | P/E | Canonical/prefetched cards, avoid repeated ingestion |
| `/api/v2/recordings/[recordingId]/audio` | GET, HEAD | A | Verified direct delivery, metadata-only HEAD, recovery |
| `/api/v2/search` | GET | C/E | Public provider cache/flights, exact query prefetch |
| `/api/v2/search/suggestions` | GET | P | Context reuse and Search intent preparation |
| `/api/v2/settings` | GET, PATCH | P/M | Fast settings projection, revision-safe repair |
| `/api/v2/shares` | POST | M/E | Prepared canonical metadata/lyric verification |
| `/api/v2/shares/[slug]` | GET | C | Indexed public read, bounded caching/coalescing |
| `/api/v2/smart-queue` | POST | P/M | Scope-aware evidence, same exact collection constraints |
| `/api/v2/taste` | GET, POST, DELETE | P/M | Compact reconciliation and expiration/deletion correctness |

Worker coverage: Node health `/`, `/health`, `/healthz`; GET/HEAD scoped and legacy audio; POST v2 capabilities/resolve/audio-info/sign-audio and legacy search/search-and-select/select/audio-info/sign-audio/download; OPTIONS. Cloudflare health/OPTIONS, v2 capabilities/resolve/audio-info/sign-audio/source-audit, scoped GET/HEAD audio, gated runtime-proof/tcp-proof. Hosted lyric worker POST `/gradio_api/call/transcribe` and GET `/gradio_api/call/transcribe/{event_id}`; its deployment/readiness must be established before reporting live inference gains.

## Done criteria and known limits

- Every existing route/method appears in the inventory and has a documented outcome/budget; new bootstrap endpoints join it.
- Prepared navigation/reading/share inputs reuse visible caches rather than duplicating requests; account changes and erasure reject late work.
- Required Bloom music/data are verified locally before entry and remain protected while in use, or preparation clearly reports its error/retry state.
- Audio preparation does not force a gap solely to wait for noncritical API calls, and user pause/account ownership wins all races.
- Existing secure/durable behavior and focused new tests pass; production build/typecheck passes.
- Final evidence names what improved, what was actually measured, and what remains dependent on hosting, providers or physical devices. Universal ≤100 ms authentication, uncached provider search, media transfer, video encoding and hosted inference are outside the physically credible guarantee.

Audit baseline: resource/navigation/PWA 39 passing; Bloom listening 109 passing. Six read-only specialist audits completed before application implementation. Mesh tools were unavailable; this document holds the reviewable plan and measurements for this session.
