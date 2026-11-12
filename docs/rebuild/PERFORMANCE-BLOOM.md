# Bloom performance and preparation

Available Bloom stories now prepare from visible shelf/gallery cards and from
the welcome screen. Enter stays disabled until private chapter JSON, the assigned
world module, every distinct chapter/artist/finale song, and required artwork are
ready. Songs use the shared full-download manager and its verified file hashes;
initial chunks and incomplete transfers cannot unlock the entrance.

Full files remain automatic cache entries rather than user-requested downloads.
Their leases stay held while the preparation/viewing has an owner. Chapter audio
borrows retained Blob URLs, so changing scenes needs no new provider request or
IndexedDB lookup. Account changes, history erasure, expiration, closed routes,
and preparation failure retire those capabilities. Private JSON persists under
the account namespace for offline revisits; erasure markers prevent old saved
stories from returning after a reload.

Shelf speculation owns one story at a time, expires after 30 seconds, and releases
on viewport/intent exit or connection/playback policy suspension. It is capped at
12 songs and 48 MiB. Opening a detail page preempts speculation and prepares its
entire required manifest, including larger stories. Full preparation pins are
released before asynchronous cache pruning, so idle files return to the budget.
Artwork consumers cancel promptly; stalled image load/decode has a 15-second
deadline and failed entries are evicted for retry. Inflight story identity is
checked before readiness, persistence and capability use.

Calendar availability remains server-enforced. Final recaps are prepared only
after the listening period ends; background preparation does not reveal chapters
or mark completion. Data-saving connections disable speculation. Failed audio,
artwork, or storage preparation presents progress/retry and keeps entry locked.

Server operations share a single transaction loader, reuse saved recap timezones,
batch saved gallery/shelf reads, and avoid repeated reveal/completion updates.
Warm prepare falls from ten database statements to five; new reveal/completion
receipts fall from eleven to six. Exact unsaved gallery chapter counts retain
their existing snapshot calculation so empty/late-sync behavior stays accurate.
Bounded timezone formatter reuse removes repeated expensive formatter creation.
Poster export deduplicates artwork and fetches up to three images together.

## Evidence and limits

- Server/calendar Bloom suite: 111 tests passed after the server changes.
- Readiness/audio suite: 25 tests passed, including delayed final files, failure,
  cancellation, snapshot replacement, retained playback, and release boundaries.
- Scoped implementation and fixture ESLint checks passed.
- `scripts/rebuild-bloom-readiness-browser.mjs` passed against an isolated Next
  development server on port 3103. It delayed the final range of a generated WAV,
  checked disabled Enter/no reveal, checked both complete saved hashes before
  enabling entry, and reopened through offline client navigation without added
  provider or preparation requests. It reported zero page errors.
- That browser run measured 835.5 ms for prepared first-chapter paint on a heavily
  contended development host. Its first route compilation took 103 seconds.
  This establishes the readiness behavior, not a production latency guarantee.
  The later retained-Blob playback refinement has separate unit coverage.
- An isolated local calendar comparison of 1,080 window pairs took 9,938.26 ms
  before formatter reuse and 692.86 ms after it (14.34 times faster in that run).
  This measures calendar CPU only, not request or network latency.

Browser evidence is under `.local/bloom-readiness/report.json`. The existing
opening/staging/listening/export fixtures now provide complete valid WAV files,
fingerprints, and range responses through `scripts/fixtures/bloom-audio.mjs`.
Production latency percentiles still need the root performance benchmark and
deployed database/network measurements. No database migration or deployment was
performed by this Bloom work.

## Final production-build verification — 12 November 2026

The readiness browser check passed against the local production build on port
3100. Enter stayed disabled until the delayed final audio range was verified.
Both complete files were pinned while the story owned them. Closing the story
and going offline released all preparation pins before the test reopened it,
so the offline result now demonstrates recovery from saved story data and full
audio after retained playback capabilities have been released. Reopening made
no new preparation or provider requests and acquired fresh pins. A subsequent
listening-erasure event closed the story, removed saved preparation, and released
the pins again. The run reported zero page errors.

Prepared first-chapter paint took 113.8 ms in this single local production run
with reduced motion. This is a browser fixture observation, not a deployed p95
or a universal 100 ms claim. The strengthened fixture and report are
`scripts/rebuild-bloom-readiness-browser.mjs` and
`.local/bloom-readiness/report.json`. The final focused readiness, image, audio,
refresh and service run passed 66 tests; scoped ESLint passed without warnings.
