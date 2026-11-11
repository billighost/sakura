# Cloudflare acquisition rollout

Implemented and deployed on 2026-11-11 under the user's approved Cloudflare
option. No payment card or paid hosting was configured.

Application: https://sakuraplayer.vercel.app

Acquisition Worker: https://sakura-audio.bb2010ng.workers.dev

The root cause was Render suspension after its bandwidth allowance was
exhausted. Further failures were independently reproduced: infrastructure 503s
were labelled busy and then missing-recording; bot title/artist fields were
truncated; Chinese accompaniment markers were unrecognized; a 256 KiB tag probe
could not contain ID3 blocks with large artwork; GramJS could create another
main sender for downloads on the authorization's own DC; and unbounded queued
RPCs could outlive a source deadline.

The implementation replaces the host with a single SQLite Durable Object,
provides the real Cloudflare TCP adapter, durably persists session/DC keys,
fences object replacement and retired clients, reuses the sole main sender for
same-DC media, bounds requests, preserves per-bot conversation queues, and
streams signed document-bound ranges with cancellation/backpressure. Source
metadata recovery uses the file's own complete tags. Instrumental identity,
artist credits, duration and verified catalogue aliases remain strict.

The app distinguishes unavailable infrastructure from throttling and missing
recordings, and propagates persisted job source reasons into safe listener
copy. An arbitrary proxy 404 cannot permanently select legacy compatibility.
Full preparation now checks container/codec, measured duration and embedded
tags before persisting the completed digest or publishing to the existing CDN.
These checks do not claim an acoustic fingerprint.

The download manager now tries the verified direct CDN/Worker URL first and
retains the app proxy as an alternate after a failed range. Previously it
preferred the app proxy even when CDN delivery was available. Reopening a
partial download also uses the resolved direct URL and preserves matching
committed chunks.

## Actual results

| Selected recording | Complete source bytes | Measured duration | Production result |
| --- | ---: | ---: | --- |
| sober — Norhan | 7,071,029 | 173.949 s | Resolved, original UUID, verified CDN |
| The Endless Quest instrumental — 张碧晨 | 7,987,928 | 192.940 s | Resolved, original UUID, verified CDN |
| Vibration — Fireboy DML | 8,107,056 | 198.504 s | Resolved, original UUID, verified CDN |
| Yoga Music — Nature Sounds Relaxation credits | 11,772,364 | 287.896 s | Resolved, original UUID, verified CDN |
| Seul le temps de se détendre — Détente nature credits | 8,541,731 | 205.845 s | Resolved, original UUID, verified CDN |

All five files completed ranged/resumed transfer, matched full embedded
metadata/duration, and decoded fully with FFmpeg. The private persistent audit
received **44,004,396 bytes**, including 524,288 diagnostic probe bytes, against
its **52,428,800-byte** cap. This cap covers that direct source-audit script;
live server-side preparation and CDN verification are additional traffic.
Earlier capped ledgers were retained.

Authenticated calls to the deployed Vercel resolver completed real DB-backed
source/preparation jobs for all five using an existing synthetic test account.
All returned HTTP 200, the selected original recording UUID, CDN delivery, and
the same SHA-256 as the completely decoded source audit. Live HEAD requests
returned the corresponding complete sizes. Existing user libraries/accounts
and device files were not cleared or recanonicalized.

Offline browser acceptance is recorded separately in the final evidence file:
it uses the production app/API and reuses the already audited byte-identical
CDN files through interception to avoid repeating remote audio transfer. This
is distinguished from the real full remote source transfer above.

That acceptance passed all five separate saved artifacts, recomputed each
device blob's SHA-256, and played each recording with the network disabled.
Successful saves issued **zero Vercel audio-proxy requests**. All audio response
bodies came from the already verified local files; no new remote audio was
requested during this final browser run. There were no page errors.

The earlier browser counter missed proxied audio because it only intercepted
CDN URLs while the manager preferred Vercel. The final acceptance intercepts
both routes and requires direct delivery; its counters replace that earlier
run. Separate live, read-only checks of all five track responses and CDN HEADs
confirmed the expected digests, complete sizes, browser CORS and exposed range
headers. Authenticated Worker capabilities reported enabled acquisition and no
fatal session error.

## Verification and maintenance

Core, server, worker, error/job, infrastructure, full-audio and Cloudflare
transport regressions passed. TypeScript and the production Next build passed;
focused ESLint has zero errors (one anonymous-default-export warning in the
Worker router). Actual local Workers execution and a hosted unauthenticated
Telegram TCP handshake passed before the real authorization was activated.
The final direct-delivery change passed 229 relevant download/playback
regressions, a fresh production build and focused lint. The browser checks
above exercised the deployed change.

The application is deployed as Vercel deployment
`dpl_FgxFCkw5Spz4y6PZawpo6mFNTd8U`. Production and Preview use the same Cloudflare
owner. The `.vercelignore` excludes private audits, credentials, recordings,
databases and the separately deployed worker from application uploads.

Vercel still serves the app/APIs and performs initial full-audio preparation
and CDN verification/upload. The app proxy can also carry audio if direct
delivery fails. Vercel transfer/compute limits and the CDN's allowance remain
relevant; the migration removes Render as the acquisition host, not every
service quota. Cloudflare does not guarantee a fixed egress IP. One owner,
main-sender reuse and fenced replacement address competing Telegram sessions.

See [worker setup and operation](../../worker/cloudflare/README.md). The free
host still has quotas and cannot control third-party source availability. A
future outage must be reported as an outage; uncertain or incomplete audio
must remain unavailable rather than bypass verification.

Private detailed evidence is in `.local/download-root-audit/` and
`.local/cloudflare-full-save/ledger.json`. Public final evidence is
`CLOUDFLARE-DOWNLOAD-EVIDENCE.json`; no secrets or signed URLs belong there.
