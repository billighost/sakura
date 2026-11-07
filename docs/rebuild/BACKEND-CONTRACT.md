# Sakura v2 recording, catalogue and audio contract

The replacement lives under `src/rebuild`. Its catalogue, identity, source
discovery, resolver, jobs and gateway import no legacy music business logic.
Authentication uses the replacement account/session adapter. The existing remote
worker is supported through a validated compatibility transport while the newly
written scoped worker protocol awaits deployment.

The base `sakura_v2` and product schemas were installed by the explicitly reviewed
migration CLI. The user subsequently authorized clearing application data and
declined migration of old listening records. The fresh catalogue was seeded from
current exact provider metadata. The verified private pre-reset backup remains
ignored locally; none of it was imported into the replacement.

## Identity and indexing

`RecordingIngestor` indexes an exact Deezer/Spotify reference. A transaction and
advisory lock reconcile verified ISRC aliases, check existing metadata/version
evidence, and enforce provider/scope/ID uniqueness. Conflicts require review;
a title match never creates a durable identity alias.

A recording has one opaque UUID. Originals, remixes, live performances, editions
and covers remain distinct. Provider references, audio assets, device downloads
and queue occurrences have separate identities. Reindexing maintains one exact
primary artist projection so provider aliases cannot double-count artist totals.

`POST /api/v2/recordings/index` is authenticated and accepts `{ reference,
expected? }`: an exact Deezer/Spotify ID and optional selected display metadata
(title, artists, duration in milliseconds, version and explicit edition).
It returns `{ recording }`. Indexing transfers metadata only and creates neither
an offline file nor a bot search. Display metadata never proves returned audio.

## Catalogue search and navigation

`GET /api/v2/search?q=...` federates Deezer and configured Spotify searches with
bounded public metadata caches. Cards retain actual provider references.
Duplicate display candidates are omitted only after strict title, artist, version
and duration comparison; this display choice creates no durable alias.
The first response includes provider totals and separate continuation cursors for
songs, artists and albums. Further requests use bounded `kind` and `cursor`
parameters, allowing the client to append pages without merging distinct remixes
or repeatedly fetching unrelated result kinds.

Live testing found Deezer did not return original Burna Boy **Ye**, while Spotify
returned exact ID `2lEl1iNGpz9r2B7R5BqXSD`. Federation fills that gap. Current
Spotify search accepts `limit=10`; `limit=20` returned HTTP 400.

`catalog.detail(kind, id)` accepts bare Deezer numeric IDs, `deezer:<id>`, or
`spotify:<22-character ID>`. Artist/album product routes also accept entity UUIDs.
DTOs retain provider references and shared artwork projections. Valid Spotify
core portraits survive restricted optional top-track/album endpoints. Product
pages can retain indexed tracks when upstream optional sections are unavailable.

## Resolve and jobs

`POST /api/v2/recordings/resolve` accepts the indexing body and returns:

| Status | HTTP | Meaning |
|---|---|---|
| `resolved` | 200 | Verified full asset, canonical recording and playback URL |
| `pending` | 202 | Persistent account-scoped job, poll URL and retry interval |
| `review` | 409 | Metadata/version disagreement or distinct ambiguous assets |
| `unavailable` | 200/404/503 | Explicit source, catalogue or infrastructure failure |

Ready aliases/assets resolve without catalogue refetch or bot search. Ready CDN
URLs are direct; worker assets receive short-lived signed URLs minted on read.
Signed URLs and bearer secrets are not persisted into jobs or catalogue rows.
Playback success still requires the browser's actual media `playing` event.
Resolved playback carries the verified `sha256` when available, so device saving
can verify the selected file against the server's full-file evidence.
External playback responses include `playback.fallbackUrl`, an authenticated
same-origin gateway URL for the **same recording and asset**. The player can retry
an unreliable direct transfer without selecting another version or file.

Missing audio enqueues bounded discovery independently of downloading.
`GET /api/v2/recordings/jobs/:jobId` enforces ownership. Next's documented `after()`
processes work; leases and two-attempt limits survive navigation/reload. An expired
final lease becomes a retryable failure. Older attempts cannot overwrite newer
results. Deployment must permit background execution (`maxDuration=120`).

### Immutable CDN preparation

With the existing Cloudinary configuration, a ready public worker source enters
`pending` with `stage: "preparing-audio"` before first delivery. Preparation reads
the full source, verifies its metadata, byte count and SHA-256, publishes an
immutable original under `sakura/v2/audio/<recording UUID>/<SHA-256>`, then reads
and hashes the delivered CDN bytes again. Only matching full files are persisted.
The canonical UUID, credited artists and version remain unchanged; the worker
asset remains available. This adds no paid provider or account upgrade.

The persisted `AudioAsset.evidence.delivery` marker identifies the verified source
asset UUID, checksum and verification time. Public ready cards project
`readyPlayback` only after repeating strict recording checks and verifying the
configured versioned Cloudinary URL, marker and matching ready source row. This
lets the player start the exact verified CDN file without a resolver roundtrip.
The card retains the authenticated same-asset gateway as its fallback. Neither
private assets nor signed worker URLs receive this public projection.

For a promotion-marked CDN asset, the authenticated gateway can deliver its
independently verified original worker source. This retains the requested CDN
asset identity and exact file bytes: the marker's source UUID, full SHA-256,
size, MIME, public owner, readiness, verification date and recording metadata
must all match. Missing/invalid proof cannot select another file or recording.
If opening that verified source fails, the unchanged CDN object remains an
available retry. This gives browser CDN failures an independent delivery path;
`X-Sakura-Audio-Delivery: verified-source-fallback` identifies that transport
in diagnostics. The gateway also explicitly cancels its body after caller
cancellation, rather than relying only on the upstream fetch signal.

Preparation coalesces equivalent work, permits two concurrent transfers per
runtime, uses bounded job leases and body inactivity deadlines, and reuses an
existing immutable object after interrupted delivery verification. Source and
CDN IDs never become interchangeable recording identities. Checksum-equivalent
files form one selection; an allowed CDN delivery outranks its matching worker
source regardless of database result order.

Quota/provider failures enter a short cooldown and return the already verified
worker with `delivery: "worker-fallback"` and `preparationFailure`. Integrity
failures require review and cannot select the suspect worker as a fallback.
Usage is read from the existing account when available; Cloudinary also enforces
its own quota. The measured account was on the Free plan at 3.84/25 credits
(15.36%) at the time of `LIVE-CDN-CHECK.json`. Those shared credits are limited;
this is not an unlimited hosting guarantee. Cold discovery and first preparation
still take time, even when an already prepared recording plays quickly.

Title, credited artists, structured version, explicit edition, duration and
authoritative ID conflicts are checked before source selection. Full-file SHA-256
evidence groups byte-identical verified source messages into one playback choice.
Different checked files remain subject to ambiguity review. Previews, wrong
artists and substitute remixes are refused.

Search summaries explicitly carry `artistsComplete: false` when a provider omits
contributors. Exact indexing may then add verified credits while preserving the
selected primary artist and every known guest. Complete canonical and source
checks still require all credits. Compound title tags such as
`Finesse (Remix; feat. Cardi B)` retain both the remix and guest evidence.
Combined performer fields are separated only when every part exactly matches
the independently known catalog credits; punctuation within an artist name is
preserved. No artist-name comparison creates a persistent provider alias.

Canonical/index/resolve responses expose `artistCredits`, an ordered array of
`{ name, role: "primary" | "featured", reference?: { provider, id } }`.
Every exact provider artist receives its own `Artist` and ordered
`RecordingArtist` relation, allowing individual artist links. Display grouping
of same-name artist search cards preserves `selectionKey` and
`alternativeReferences`; it does not merge their database identities.
Index review responses retain `reason`, rejected fields and the candidate's
exact catalog reference so the client can offer a useful recovery action.

JSON mutations reject cross-origin browser requests, limit bodies to 32KB and
apply read deadlines. Resolver/job responses use private no-store.
Audio index/resolve/job/gateway account reads are inside their error boundary:
an exhausted account-read failure returns private 503, rather than an uncaught
500. Missing sessions stop before metadata/body/media work with private 401.

## Audio gateway

`GET/HEAD /api/v2/recordings/:recordingId/audio?assetId=:assetId` authenticates the
account and repeats recording ownership and source identity checks.

| Request/result | Response |
|---|---|
| Normal GET | 200, validated MIME and streaming body |
| Single byte/suffix range | Exact 206 and Content-Range |
| Unsatisfiable range | 416 and total file size |
| Malformed/multiple ranges | Ignore Range, serve normal 200 |
| HEAD | Verified stored size/MIME, no audio bytes |
| Missing/wrong account asset | 404 |
| Preview/unverified/wrong recording | 409 |
| Wrong source MIME, range, size or failed source | 502 |

HTTPS origins and redirects are allowlisted. Credentials remain server-only.
Header deadlines stop after headers arrive; audio continues streaming normally.
Truncated/oversized bodies error rather than completing corrupt offline files.
HEAD reports stored verified metadata; GET checks the source. No full-file buffer
delays playback.

## Worker protocols and configuration

The new worker implements `/v2/resolve`, `/v2/audio-info`,
`/v2/audio/:chatScope/:messageId`, and `/v2/sign-audio`. New conversations use exact
catalogue URLs, bounded serial work, hard version/artist gates, and chat-scoped
document caches. Signed authorization binds scope, message and expiry. Ranges,
suffixes, HEAD, cancellation and file-reference refresh are supported.

The checked live Render worker is connected and accepts the existing bearer,
but its v2 route returns 404. Compatibility uses its current `/search-and-select`
with the exact catalogue URL, then independently checks `/audio-info` tags, MIME
and size. Only the primary bot is permitted because old paths are not chat-scoped.

**Local v2 worker code has not been deployed.** Replace the remote worker with
one owner shutting down cleanly before its replacement opens the same Telegram
session. Live tests used the existing owner and opened no second local session.
Run `node scripts/build-rebuild-worker.cjs` after changing the pure recording core
to regenerate the local deployable worker's checks before deployment.

Required configuration is `DATABASE_URL` (or `SAKURA_REBUILD_DATABASE_URL` override),
`TELEGRAM_WORKER_URL`, matching server-only `WORKER_SECRET`, and
`TELEGRAM_BOT_USERNAME`. `SAKURA_REBUILD_AUDIO_ORIGINS` allowlists CDN origins;
Spotify client ID/secret enable federation and exact lookup. `YOUTUBE_API_KEY`
optionally enables public playlist metadata.
Existing `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`
enable immutable audio promotion. API credentials stay server-only.

Ignored local `.env` was configured from existing private worker pointers after
checking the live origin and bearer. No secrets appear in docs or reports.
Runtime composition uses a version and server-only configuration fingerprint,
preventing stale development services from retaining obsolete adapters.

## Import

`POST /api/v2/import` takes `{ url, confirm }`. Preview exposes matches/review;
confirmation indexes exact verified entries and transactionally creates a playlist
with unique canonical recordings. Deezer/Spotify pagination is bounded and repeat
pages are rejected. Public HTTPS provider URLs are accepted; arbitrary/internal
URLs are refused. YouTube HTML has a bounded body and parser preserving braces
and script delimiters inside titles. Private playlists and unresolved matches
are reported explicitly.

## Validation and limits

Core: `node scripts/test-rebuild-core.cjs` (27 regressions).
Server: `node scripts/test-rebuild-server.cjs` (54 strict fixture regressions, no credentials).
Audio routes: `node --import tsx --test scripts/rebuild-audio-route.test.ts`
(2 real-handler regressions covering 5 HTTP methods; no database/network access).
Worker: `node --test worker/rebuild/service.test.cjs` (8 regressions: scopes,
version gates, bounded queues, malformed references, aligned suffix bytes and HEAD).

Live commands:

    npx tsx scripts/rebuild-audio-smoke.ts --live --index-verified --full
    npx tsx scripts/rebuild-version-smoke.ts --live
    npx tsx scripts/rebuild-audio-ready.ts
    npx tsx scripts/rebuild-promote-audio.ts --live
    npx tsx scripts/rebuild-cdn-browser.ts
    node scripts/rebuild-recording-browser-smoke.mjs
    node scripts/rebuild-audio-fallback-browser.mjs

The first uses the remote worker, checks tags/range/signed HEAD, transfers and
hashes full audio, and checks decoded duration/tags with ffprobe. Private files
remain under ignored `.local/rebuild-audio-check`; public metadata-only evidence
is in `LIVE-AUDIO-CHECK.json`. Both original Finesse and Ye were decoded with
expected durations and artist/title tags. This is identity/integrity evidence,
not acoustic fingerprint certification for every recording.
The version check independently selects the original Finesse, Cardi B remix and
INERTIA catalog IDs, validates full ffprobe title/credits/version/duration and
persists their checksums. All three passed in `LIVE-VERSION-CHECK.json`.

The ready check measures server resolution and signing cache, excluding browser
decode, device/network first byte and cold Next compilation. Never-resolved songs
still require discovery. Catalogue metadata and animation cannot manufacture an
instant full source; unavailable outcomes remain explicit.

An additional actual Chrome check played original Finesse through both its signed
worker URL and the authenticated gateway. Both emitted `playing`, advanced media
time, decoded duration 191 seconds and reached readyState 4. Browser-style GET
`Range: bytes=0-` returned exact 206/audio-mpeg/full-size bounds on both paths.
The private report is `.local/rebuild-media-play-report.json`. This confirms real
playback for these samples; HEAD alone was not used as playback evidence.

`LIVE-HTTP-AUDIO-CHECK.json` also records real signed-in localhost resolver and
gateway checks: original Finesse/Ye both resolved successfully, their authenticated
gateways returned exact 206/4096-byte samples, and warm resolver responses measured
973ms/863ms. The latest server-only warm measurements in `LIVE-READY-CHECK.json`
were 593ms/630ms for Finesse/Ye, 578ms for the remix and 506ms for INERTIA.
The first Finesse resolution took 4.23s including process/database/signing startup;
these are local samples, not universal latency guarantees.

Full source-timing investigation is recorded in `LIVE-SOURCE-TIMING.json`.
Worker full-file transfers succeeded but browser media readiness was slow; the
first complete application run also exposed concurrent save failures for the
remix and INERTIA. The browser investigation found `cache: "no-store"` improved
request headers, and a distinct authenticated transfer could complete while
media streamed. It did not establish that the remote worker globally serializes
all requests. Client saving now uses bounded transfer/fallback handling and
requires the expected digest before committing an offline artifact.

`LIVE-CDN-CHECK.json` records source-to-CDN exact full byte/digest preservation
for original Finesse, Cardi B's remix, INERTIA and Ye. The fresh Chrome playback
check in `LIVE-CDN-BROWSER-CHECK.json` emitted `playing` at 1.855s, 3.775s,
2.123s and 2.080s respectively; every full duration matched, media time advanced,
and no media errors occurred. These measurements begin at the user gesture
after preparation; they exclude catalog resolution and preparation. They are
observed samples rather than a subsecond or global startup guarantee.

Later delivery rechecks exposed changed conditions: a direct CDN 4096-byte range
completed in 1.03s, while a full CDN transfer timed out at 30s after 1.73/7.80MB.
The worker's exact original completed in 12.27s in one sample, while the
marker-backed gateway's next full transfer took 80.8s and still matched the exact
source digest. Network performance varies; the early CDN timings are historical
samples. A fresh original gateway body cancellation took 1.013s after headers and
stopped after 65,491 bytes. Metadata-only observations are recorded in
`LIVE-DELIVERY-RECHECK.json`; none of those partial transfers became downloads.

The complete browser acceptance script is restricted to isolated localhost
ports 3002/3003 and the ignored synthetic test account. It verifies exact live
search-to-like UUIDs, individual artist links, real advancing full playback,
complete SHA-256 offline artifacts, provider alias reuse, four unique download
rows, one playing row, and playback with the network disabled. Selectors filter
visible retained pages because Next Cache Components may keep inactive routes
mounted through React Activity. Its report remains ignored under `.local`.

The additional fallback browser check injects a failed **browser connection**
to the known CDN file and retains real upstream media. On isolated development
port 3002 it successfully retried playback through a 206 same-asset gateway,
then retried saving through the gateway's 200 response. The full 7,802,010-byte
Finesse artifact retained the expected SHA-256, played for the correct duration,
and advanced media time. No page errors occurred. The ignored report is
`.local/rebuild-audio-fallback-browser-report.json`; final production-origin
acceptance reruns the same test after the production build.
Setting `SAKURA_TEST_FAULT=stall` holds direct browser CDN connections for 45s;
the same test requires playback to recover before that artificial connection
fails and still checks a complete, exact-SHA saved artifact. The player now
arms a 12-second no-progress watchdog while a verified source has an unused
same-asset fallback. It is reset by real media-time progress and canceled by
pause, account/source changes, completion and teardown. Production-build QA
recovered the artificial 45-second stall in 25.5 seconds including gateway
startup, then saved the exact 7,802,010-byte artifact. The final four-recording
acceptance also passed for Finesse original/remix, INERTIA and Ye, including
offline playback and distinct canonical download rows.
