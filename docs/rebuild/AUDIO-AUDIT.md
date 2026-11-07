# Audio, recording identity, downloads and playback audit

Audit date: 2026-11-07. Findings below are verified from the source. Regression
checks exercise the newly written core using fixtures; they do **not** claim
that real Telegram audio was retrieved, that a production database was changed,
or that the current application has already been migrated.

This is the historical audit of the original implementation. Subsequent production
work installed the fresh schema, replaced the app adapters and verified real full
Finesse/Ye audio. See `BACKEND-CONTRACT.md`, `LIVE-AUDIO-CHECK.json` and
`LIVE-HTTP-AUDIO-CHECK.json` for current implementation and live evidence.

### Follow-up streaming and delivery

The real browser run found slow worker readiness (roughly 13–29 seconds to one
second of playback) and stalled concurrent offline saving for the remix and
INERTIA. Full Node transfers, byte ranges and source SHA-256 were correct, so
metadata validation alone did not resolve the delivery problem. Source MP3
headers and tags were small and valid. Header/fetch timing improved with
`cache: "no-store"`; a separate authenticated transfer completed concurrently.
The evidence does not prove that every remote request is serialized.

The replacement now prepares a public full recording on the existing
Cloudinary account, using an immutable recording UUID/checksum path. Both the
worker bytes and delivered CDN bytes must match the complete size and SHA-256
before a ready marker is persisted. Existing originals/remixes and individual
artist credits stay distinct. A correctly marked ready card can start this exact
CDN file without another resolver call; the original verified worker remains
available if preparation has a quota/provider failure. Integrity failures need
review. Preparation is bounded/coalesced, and no account upgrade was made.

All four source/CDN files passed full-digest verification. Actual fresh Chrome
media playback emitted `playing` at 1.855s original Finesse, 3.775s Cardi remix,
2.123s INERTIA and 2.080s Ye, with correct full durations, advancing time and no
media errors. This excludes catalog resolution and first preparation. Evidence:
`LIVE-SOURCE-TIMING.json`, `LIVE-CDN-CHECK.json` and
`LIVE-CDN-BROWSER-CHECK.json`. Shared Free-plan CDN quota is limited; the snapshot
was 3.84/25 credits, not an unlimited allowance.

Latest server validation: 54 regressions passed, including forged delivery
markers, checksum-equivalent CDN preference, unchanged canonical identities,
coalesced immutable publication, quota fallback and integrity review. The complete
production-app browser check additionally verifies concurrent save completion,
provider/canonical alias reuse and actual offline playback on an isolated origin.
Later live rechecks found varying delivery performance: a full CDN transfer
timed out at 30s, while an exact original worker file completed at 12.27s in one
sample. The authenticated gateway now uses only the marker-backed byte-identical
original as an independent CDN fallback, preserving recording/asset identity and
all metadata, SHA, size, MIME and owner gates. Caller cancellation explicitly
stops gateway body delivery. See `LIVE-DELIVERY-RECHECK.json`; early Chrome startup
measurements are historical samples, not a current reliability guarantee.

### Follow-up source verification

The new recording review path had two additional issues: compound
`(Remix; feat. Cardi B)` tags lost their feature credit, and search summaries
were treated as complete even when Deezer omitted contributors. Source files
also combined multiple performers into one tag. These are corrected with
separate version/feature parsing, an explicit incomplete-search flag and exact
contextual credit parsing. Wrong primary/guest, named remix, duration and preview
checks remain in force.

`LIVE-VERSION-CHECK.json` records complete source transfers and ffprobe checks
for original Finesse (7,802,010 bytes), the Cardi B remix (8,967,525 bytes) and
INERTIA by SawanoHiroyuki[nZk]/REI (8,316,270 bytes). All three passed title,
credits, version and duration checks, and their SHA-256 values were persisted.
Original Finesse retained its canonical ID and prior checksum; the remix is a
separate canonical recording. This verifies tagged-file identity and integrity;
it is not an acoustic fingerprint claim. No personal account rows were mutated.

Current focused verification: 27 core, 43 strict server and 8 worker tests pass;
scoped ESLint passes. The remote scoped v2 worker remains undeployed; live checks
used the existing primary-chat worker owner without opening another session.

## The underlying problem

A catalogue entry, a recording, a Telegram message, an offline file and a queue
occurrence are treated as interchangeable track IDs. They are different entities.
Patching each screen independently has produced aliases as additional library
rows, recording variants that share a hash, and asynchronous playback code that
has to repeatedly guess which ID is authoritative.

## Confirmed defects

| Severity | Finding and evidence | Effect | Replacement requirement |
|---|---|---|---|
| Critical | `src/lib/deterministic.ts:8` removes all parenthesized/bracketed text, feature credits, and every character outside ASCII letters/digits; line 20 hashes that value. | Original, remix, live and radio-edit titles can share an ID. Different Japanese titles/artists can normalize to the same empty text. | Opaque canonical recording ID plus verified provider aliases. Preserve Unicode and recording version metadata. Never derive identity from a destructive title hash. |
| Critical | `worker/telegram.js:638` initializes a default result and lines 641–679 score buttons using preview flags, duration and bitrate only. Line 686 returns the selected file without comparing title, artist, featured artists or version. | A high quality remix can win over the original. A close duration is insufficient proof of the requested recording. | Hard title, primary/featured artist and version gates before duration or quality ranking; verify the actual returned audio metadata again. Reject ambiguity. |
| Critical | `src/lib/metadata.ts:320` uses **OR** between title containment and artist containment, and line 327 falls back to the first result. Its query strips non-ASCII text at line 304. | Any track by the same artist can satisfy a search; non-Latin search loses information. Wrong metadata can then be assigned to a selected audio file. | Preserve Unicode queries; require all relevant identity evidence; return unavailable/ambiguous rather than silently choosing the first result. |
| High | `src/app/api/music/download/route.ts:53` receives the exact requested Deezer ID, but line 246 re-searches by title/artist to choose the bot URL. Line 382 subsequently prefers the **requested** Deezer ID when saving the returned bot recording. | The resolver can fetch a different version and bind the selected catalogue ID to the wrong audio. A persistent poisoned cache makes the mistake recur. | Resolve the exact catalogue reference; independently validate returned metadata before binding an alias. Never persist requested IDs as proof of returned audio identity. |
| High | `src/components/PlayerContext.tsx:580` saves canonical download metadata; line 604 saves a second row under the original virtual ID with `blobId` pointing to the first. | One completed download appears twice in Downloaded Songs. Sharing a blob saves space but does not prevent duplicate visible rows. | Separate `recording_aliases` from `download_manifest`; one completed manifest row per account/device/canonical recording. |
| High | `src/components/PlayerContext.tsx:434` looks for a metadata match and line 436 calls `cloneDownloadedTrack`; `src/lib/offline-db.ts:341` saves another metadata row. `getAllDownloadedTracks` at line 355 returns all rows on the device, including aliases. | Playing/downloading the same recording from a new mix or search adds another visible entry. | Resolve aliases to canonical recording IDs before enqueueing; store aliases outside the displayed manifest. No metadata clones. |
| High | `src/components/TrackRow.tsx:175` marks a row active if either the current ID or resolved ID equals its ID. | When both virtual and canonical rows are visible, both may show the playing state. Queue repeats also need occurrence identity. | One library row per recording; a unique `entryId` per queue occurrence; current queue state identifies the occurrence. |
| High | `src/lib/offline-db.ts:14` keys track metadata only by `id`; line 296 considers matching `deviceId` sufficient for downloaded status. Lines 355–359 expose all device rows regardless of account. | Account metadata can overwrite another account's row. A manifest can say “downloaded” when the blob is missing or incomplete; another account's library can remain visible. | Explicit account/device/recording composite key and verified complete artifact reference. Define deliberate guest-to-account migration rather than implicit device-wide reads. |
| High | `src/components/PlayerContext.tsx:1669` tests `isTelegramStreamUrl` when deciding whether to resolve audio. | A ready absolute CDN stream is treated as unresolved and sent through the slow download resolver again. | An explicit full-audio asset state and direct CDN playback; stream resolution and offline download are separate actions. |
| High | `src/lib/telegram/worker.ts:280` uses `AbortSignal.timeout(45_000)` on the worker audio fetch; the preceding comment calls it a time-to-first-byte deadline. | Fetch's signal also aborts body consumption after 45 seconds. A slow full-file download or long-lived stream can fail after headers arrive. | Clear the header deadline on receipt of headers; separately handle caller cancellation, inactivity, and deployment lifetime. |
| High | `src/app/api/music/download/route.ts:263` permits 120s search + 60s select, with two attempts per query and fallback bots. `worker/telegram.js:76` uses an unbounded serial bot queue. `worker.ts:141` adds another 60s timeout allowance. | Streaming a never-resolved song waits on bot search, audio creation and catalogue enrichment. Under concurrent users, waiting time increases further. | Catalogue/audio resolution jobs should populate ready assets ahead of playback; bounded jobs with explicit pending status, cancellation, and retry budgets. A song without a ready full-audio asset cannot honestly promise instant playback. |
| Medium | `src/app/api/stream/telegram/[messageId]/route.ts:181` hardcodes `audio/mpeg`; the worker reports the actual MIME type at `worker/index.js:211`. Line 182 marks an authenticated response `public`. | FLAC/other payloads can be described incorrectly; caching policy differs between app proxy and worker. | Forward validated content type and private/session-appropriate cache policy consistently. |
| Medium | `src/app/api/stream/telegram/[messageId]/route.ts:121` parses only start-offset ranges, while `worker/index.js:174` supports suffix ranges. The app uses a 206 response even for a rangeless request when size is known (line 201). | The proxy and worker disagree about Range semantics; suffix probes fall back to downloading the full entity. | One RFC-compliant range implementation: rangeless 200, valid single range 206, unsatisfiable 416 with total size, suffix support. |
| Medium | `src/app/api/telegram/select/route.ts:75` updates a stub audio URL in SQL but line 89 returns the old `dbTrack.audioUrl`; `NULLIF` only handles `pending`, not an empty string. | A successful selection can return stale/unusable audio despite updating the database. | Return the updated asset from `UPDATE … RETURNING`; represent unresolved audio as a state, not a fake URL. |
| Medium | `prisma/schema.prisma:127,145–146` declares ordinary indexes for Deezer and Telegram message IDs, while `scripts/migrate-dedupe-tracks.js:162` separately creates a unique Deezer index. | Schema and migration expectations disagree. Actual live constraints must be inspected before migration; the source alone cannot establish them. | A versioned replacement schema with unique provider-scoped aliases and an audited migration ledger. |

The worker history “fast path” is also unsafe for versions: containment at
`worker/telegram.js:583` allows extra version tags and compares no duration.
Do not preserve this shortcut unless it uses the same hard identity gates as the
normal resolver. Its ASCII normalization at line 578 also excludes non-Latin music.

## New independent core implemented

These files import no legacy player, database or provider code:

- `src/rebuild/core/types.ts`: separate recording metadata, catalogue references,
  version information and audio candidates. Durations are consistently milliseconds.
- `src/rebuild/core/identity.ts`: Unicode-preserving normalization and conservative
  version parsing, featured credits, provider/chat-scoped aliases, conflict-safe
  batch binding. Similar title text never becomes a durable alias automatically.
- `src/rebuild/core/matching.ts`: hard title/artist/version/explicit/duration gates,
  authoritative ID conflict detection, no preview substitution, ambiguity outcomes,
  and quality selection only after recording correctness is established.
- `src/rebuild/core/downloads.ts`: one manifest row per account/device/recording;
  monotonic progress; a full artifact and SHA-256 before completion; stale attempt
  callbacks ignored; aliases do not create extra downloaded songs.
- `src/rebuild/core/queue.ts`: one occurrence ID per insertion, stable active item
  during reorder, play-next insertion, removal, repeat semantics, clamped seek,
  and request versions that reject callbacks from an earlier selected track.
- `src/rebuild/core/streaming.ts`: valid byte-range parsing, explicit full/preview
  playback plans, immediate use of ready CDN/offline assets, and a headers-only
  fetch deadline cleared before body streaming continues.

The core intentionally has no global singleton: request/server lifetimes must not
turn one listener's queue or private download state into another listener's state.
`RecordingAliases` is an in-memory specification. Production bindings need a
transactional table and database uniqueness constraints, not this map as a database.

The conservative matcher may refuse a correctly performed song if a source omits
featured artists, duration or a named version. That outcome is deliberate: an
adapter can resolve more authoritative evidence or present a version picker.
It must not guess a recording and label it verified.

## Replacement persistence and API contracts

1. `recordings`: UUID, display title, primary/credited artists, duration in ms,
   structured version, explicit edition, provenance and confidence.
2. `recording_aliases`: recording UUID + provider + provider scope + provider ID;
   unique across `(provider, scope, provider_id)`. Spotify/Deezer release IDs may
   point to the same recording when independently verified. Telegram message IDs
   require chat scope. Never merge different versions by title alone.
3. `audio_assets`: recording UUID, provider locator, full/preview type, readiness,
   real MIME type, duration, size, checksum, validation result and source provenance.
   Keep the requested metadata and returned audio evidence for diagnosing bad matches.
4. `download_manifest` and `offline_artifacts`: account/device/recording key plus
   complete artifact, bytes, digest and state. Blob plus completed manifest should
   be committed atomically in IndexedDB. Aliases are not manifest rows.
5. `queue_occurrences`/playback snapshot: occurrence UUID, canonical recording UUID,
   order, source context; a selected occurrence and transport version. Reordering
   must preserve active playback; identical recordings may repeat intentionally.
6. `listening_events`/lifetime totals: user-owned history with stable recording
   mapping. Preserve existing raw audible milliseconds **and** rolled-up totals
   before any catalogue deletion; current `Track` cascades can erase both.

Suggested API behavior:

- `POST /api/v2/audio/resolve`: exact recording reference; returns ready asset,
  a pending job ID, ambiguity candidates, or a typed unavailable result. Accept a
  request idempotency key. Never make offline saving a side effect of playing.
- `GET /api/v2/audio/:assetId`: validated full audio with consistent Range/MIME,
  cancellation and private caching. Prefer direct signed/CDN delivery where ready.
- `POST /api/v2/downloads`: canonical recording ID. Idempotent per account/device;
  track resolution progress separately from file transfer progress.
- `GET /api/v2/catalog/:recordingId`: one canonical entity and variant links;
  provide artist/album image metadata from the same normalized entity service.

Playback needs an audio adapter that starts only a ready full asset, treats an
actual `playing` event as success, cancels prior requests on track change, revokes
object URLs, and carries the reducer's request version into all callbacks.
An HTML media element may emit late events from a reused source; verify both its
active load token and expected source before dispatching, not just the current token.

## Migration order and retention

1. Produce a read-only audit and a verified export of all user history/totals.
   The old per-recording aggregates and raw events must not be double-counted.
2. Create the new schema alongside the old one and seed recording mappings from
   exact external IDs plus validated metadata. Quarantine mismatched originals,
   remixes, non-Latin hash collisions, and unverifiable Telegram assets.
3. Import personal data through the mapping; reconcile sums against the export.
   Unmatched historical recordings can retain an archived metadata snapshot so
   listening hours do not depend on keeping a playable catalogue row.
4. Move the player and pages to new adapters and explicit canonical identities.
   Migrate local blobs by checksum plus verified recording mapping. Use a dedicated
   new IndexedDB version/store, with account/device scopes and rollback metadata.
5. Validate offline, browser refresh, concurrent track changes, Safari seeking,
   interrupted resumes and actual provider playback in the selected UI direction.
6. Retire old tables/routes only after history reconciliation and acceptance checks.

## Verification delivered

Run `node scripts/test-rebuild-core.cjs`. The command typechecks the new core,
compiles it into a temporary directory and invokes Node's test runner; cleanup
removes only that newly created temporary directory. No server, secrets, accounts,
live database or provider access is needed.

**27 core tests passed.** Coverage includes the Finesse original/remix distinction;
cross-provider Ye aliases yielding one download; non-Latin identity preservation;
alias conflict rollback and chat scoping; preview/artist/title/duration rejection;
explicit/live variants; ambiguous source results; download completeness and stale
transfer attempts; repeated queue songs showing one current occurrence; stale
resolver callbacks; play-next/reorder/remove/repeat/seek; byte and suffix ranges;
direct CDN/offline playback plans; and deadlines that stop counting after headers.

Live source tests now verify original Finesse, its Cardi B remix, INERTIA and Ye
through the replacement adapters with full source/CDN hashes and decoded tags.
Fixture and sample correctness still cannot establish that every recording is
available upstream or that a cold source can serve instantly.
