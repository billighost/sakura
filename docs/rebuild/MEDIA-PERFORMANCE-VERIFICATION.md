# Media, lyrics, readings and sharing performance

Implemented in the Sakura checkout on 2026-11-11. These results are local correctness and preparation measurements, not production latency guarantees.

## Changes

- Share video preparation reuses the already rendered card canvas and its decoded audio. Codec capability probes share results by the actual output dimensions. The bounded clip audio encodes concurrently with video instead of allocating and copying an audio buffer per frame. Output keeps its original 1080-pixel dimensions, 24 fps, exact clip position and Opus recording audio.
- Audio preparation belongs to the sharing dialog, binds account/recording/source revision, coalesces consumers, cancels abandoned work and retains at most one decoded recording up to 96 MiB for two minutes. Choosing Video warms only a Blob already on the device or a matching verified account-scoped download, avoiding speculative remote audio downloads during listening. Closing the dialog or changing sources releases preparation.
- Ready video identity includes the exact source, card content, start position and duration. Song clip position is captured when Video is selected. Native file sharing still happens from a separate user click after preparation.
- Validated artwork bytes and ETags reuse normalized-URL requests, with a 32 MiB/64-entry cache and explicit CDN caching. Approved host/redirect rules, allowed media types, the 8 MiB response limit and existing week freshness remain enforced before bytes are cached.
- Reading transformations share exact text/language/engine identities in a 4 MiB/128-entry cache. Every caller's original timestamps and word fields are merged afresh.
- Verified recording actions construct lyrics identities with the full artist credits, language and edition metadata. The exact LRCLIB request remains first; subsequent alias searches run with at most two concurrent requests, and a verified synchronized result cancels a stalled sibling. Outages remain distinguishable from confirmed missing lyrics.
- Successful lyric publication returns its confirmed acceptance without waiting for up to four provider index readbacks. The existing `published:true`/202 contract refreshes the lyrics read endpoint separately. The standalone publication helper retains inline readback by default. Acceptance invalidates pre-publication client flights and negative cache so a late old 404 cannot overwrite the refreshed publication.
- `prefetchLyrics(track, signal)` shares the player's existing request flight and persistent cache for intent/next-song preparation. It retains all credits and language, respects cancellation, and preserves provider-failure semantics.
- Public share pages and APIs share concurrent database queries. Completed share data is not retained in this server cache, so a later deletion remains visible on the next server read. Independent public share and authentication reads start together for the public page.

## Evidence

The same 80-line synthetic Japanese fixture using the production transformation function originally took 1,020.92 ms on dictionary initialization and 54.97/42.47/46.21 ms on subsequent uncached transformations. With the new transformation cache, another local run took 1,158.66 ms cold and 1.74/0.44/0.34 ms on repeated content. These measurements exclude HTTP, authentication and database time; cold dictionary initialization still costs about a second.

Actual Chromium export checks produced a playable 1080×1080 WebM, 1.02 seconds long, with the expected 880 Hz selected recording audio and nonzero audible energy. After preparation, export made zero additional audio requests and zero duplicate card text paints. The active fixture player continued with an unchanged source. Cached audio retrieval took 0–0.1 ms. Cancellation returned `AbortError`, and out-of-range clip positions were rejected. Actual one-second encoding varied from approximately 2.2 to 9.1 seconds under local concurrent work; preparation measurements do not establish instant encoding or a controlled end-to-end speedup.

Browser evidence is generated under ignored `.local/rebuild-share-export-report.json`, `.local/rebuild-share-export.png` and `.local/rebuild-share-export.webm`.

The broader targeted media/lyric suite passed 145 tests before the final search/publication additions. The subsequent provider/publication suite passed 108 tests; the final focused additions passed 36 tests. These overlapping runs must not be summed as a unique test count. Targeted ESLint reported no errors, with the existing share-preview image warning remaining.

## Reproduce

```text
node --import tsx --test scripts/rebuild-media-cache.test.ts scripts/rebuild-share-preparation.test.ts scripts/rebuild-share-identity.test.ts scripts/rebuild-lyric-search-performance.test.ts scripts/rebuild-lyric-prefetch.test.ts scripts/rebuild-lyric-publish.test.ts scripts/rebuild-lyrics.test.ts scripts/rebuild-lyrics-interactions.test.ts scripts/rebuild-hosted-sync.test.ts scripts/rebuild-reading-cache.test.ts scripts/rebuild-shared-flight.test.ts
node scripts/rebuild-export-smoke.mjs
```

The optional `node scripts/rebuild-export-smoke.mjs --benchmark` also compares
5-, 8- and 12-second clips with prepared versus unprepared inputs using the
current renderer. Each mode verifies 1080-pixel output, exact selected 880 Hz
audio, playback continuity, audio reads, card rendering, first progress and
completion time. It uses a generated 15-second local WAV, alternates mode order,
and writes `.local/rebuild-share-export-benchmark.json`. The codec probe is warm
in both modes; one sample per mode establishes behavior and local timings, not
production percentiles or a comparison against the former implementation.

On 12 November, the sequential local Chromium benchmark passed all six clip
checks. Every finished file contained the selected 880 Hz recording, audible
energy, 1080 × 1080 video and the expected duration (5.02, 8.02 or 12.02 seconds).
The separate player kept advancing with the same source throughout every export.

| Clip | Unprepared export | Prepared export | Advance input preparation | Prepared first progress callback |
| --- | --- | --- | --- | --- |
| 5 seconds | 2,613.7 ms | 1,671.3 ms | 59.5 ms | 0.1 ms |
| 8 seconds | 3,621.0 ms | 3,037.6 ms | 77.5 ms | 0.1 ms |
| 12 seconds | 3,104.3 ms | 3,503.9 ms | 76.7 ms | 0.2 ms |

Each unprepared run read 661,544 bytes from the local Blob and rendered the card
once. Each prepared run reused its inputs with **zero audio reads, zero audio
bytes and zero repeated card text paints during export**. This removes work from
the user's export click; advance preparation still has a cost. The first progress
numbers measure the renderer callback, not a browser paint. The 12-second prepared
run finished later than its unprepared counterpart, so these single samples do
not establish a consistent total encoding speedup. Both modes use the current
encoder, warm codec probes and local generated audio; no remote transfer latency
is simulated. The default one-second smoke also passed, including cancellation
and out-of-range clip rejection. The final focused sharing/lyrics/public-reading
suite passed 41 tests; the benchmark script passed syntax and ESLint checks.

The hosted lyric analysis worker is externally limited, and existing project documentation does not establish a deployed/benchmarked worker. These changes do not claim faster live hosted inference or alter source, checksum, duration or alignment verification gates.

## Public reading Redis layer — 2026-11-12

Reading transformations now consult the shared Redis adapter only after a local L1 miss and verification that the complete ordered source text is public. Successful verified `/api/v2/lyrics` responses register a bounded hash-only local eligibility record and issue an optional, purpose-derived AUTH_SECRET HMAC proof. The proof includes only a public provider/source identifier, SHA-256 of the exact ordered texts, issue time and a one-hour expiry. It contains no raw lyric text, account state or audio address. The client retains this optional proof with its lyric cache and forwards a bounded token with reading requests.

The signed proof allows a different cold serverless reading instance to validate public-source eligibility without relying on the producer's process memory. Unknown, altered, partial or private draft text falls back to local transformation without any Redis command. A fresh instance cannot accept missing, forged or expired proofs; an existing exact public-text registry record remains a valid local eligibility source. The authenticated reading handler continues validating the original body and merges the caller's own text/timestamps/word fields after a hit.

Redis entries contain only pronunciation/review/engine fields in a versioned envelope bound to the content, language and current engine key. Malformed cache data or unavailable Redis recomputes locally. Ordinary warm L1 hits make no Redis request. Source edits use a new content key automatically. Full mutable lyric-result mappings remain outside Redis because cross-instance publication ordering would require atomic generation fences and L1 invalidation.

`scripts/rebuild-public-reading-redis.test.ts` covers proof tampering, expiry, wrong secrets, complete ordered-text matching, zero private-draft Redis commands, reuse across independent handler/cache helpers, caller timing preservation, malformed hits/outages, changed content keys and capped hash registry. The final focused run passed 30 public-reading/media/prefetch/publication tests with no targeted lint errors. Reproduce it with:

```text
node --import tsx --test scripts/rebuild-public-reading-redis.test.ts scripts/rebuild-media-cache.test.ts scripts/rebuild-lyric-prefetch.test.ts scripts/rebuild-lyric-publish.test.ts
```

Publication refresh also fences persistent negative deletion by the current cache version and reads the stored value inside its write transaction. It deletes only a confirmed missing entry, preserving any concurrent fresh lyric publication.
