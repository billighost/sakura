# Media admission, preparation memory and job polling

Implemented against `5229fdb` on 12 November 2026. Measurements below use generated local data and mocked providers. They do not establish deployed latency, provider throughput, physical audio latency or production percentiles.

Artwork delivery now admits at most four active and 64 queued unique transfers. All admitted identities remain shared, including queued requests. Each consumer owns an independent cancellation subscription; the last departing consumer cancels queued or active work. Queue time is included in the existing eight-second deadline. Overflow returns a retryable 503 without starting another upstream fetch. Existing allowed-host/redirect rules, eight-MiB response limit, validated byte cache, checksum ETag and HTTP cache headers remain.

The previous blocked-fetch fixture started 81 transfers for 80 unique URLs plus a duplicate of the overflow URL. The regression now starts only four before release and completes exactly 80 upstream requests with a peak of four. A separate admission test proves rejection before network work, queued cancellation, replacement admission and finite deadlines even when an injected fetch ignores abort.

Source preparation retains one exact-sized assembly buffer instead of retaining all chunks plus a second concatenated recording. Upload uses a view of that buffer before the Blob's required immutable snapshot. CDN verification hashes and checks size/MIME incrementally without retaining another complete file. Full source SHA, embedded metadata/container/duration inspection, immutable upload identity, full CDN checksum verification and verified-source fallback remain authoritative. Busy and asynchronous failures now share the same 1,000-entry eviction bound; expired queried failures are removed.

The following isolated-process comparison loads the actual baseline promotion module from Git and the current module. Each mode assembles and uploads two simultaneous generated PCM-WAV files, then verifies complete generated CDN responses. Cloudinary calls are mocked. The WAV fixtures have valid container headers and deterministic bytes; timing includes hashing and fixture generation, and does not include live transport or serverless filesystem behavior. RSS/external/ArrayBuffer peaks are sampled at stream and provider boundaries relative to initialized-module memory; these are sampled peaks, not a continuously profiled maximum.

| File size / two jobs | Baseline RSS increase | Current RSS increase | Baseline ArrayBuffers increase | Current ArrayBuffers increase | Baseline/current elapsed |
| --- | --- | --- | --- | --- | --- |
| 5 MiB each | 60.97 MiB | 39.58 MiB | 60.00 MiB | 36.75 MiB | 359.10 / 468.07 ms |
| 30 MiB each | 244.17 MiB | 183.58 MiB | 240.00 MiB | 180.00 MiB | 1,117.96 / 957.29 ms |
| 120 MiB each | 964.29 MiB | 555.18 MiB | 960.00 MiB | 551.50 MiB | 8,518.58 / 5,112.10 ms |

One sample per mode under concurrent local work establishes lower observed working memory, not a stable elapsed-time speedup. The five-MiB current run was slower. Source inspection still retains a complete recording buffer, and Blob upload still takes its immutable snapshot. Two maximum-size jobs therefore remain substantial allocations. A file-backed verification/upload spool remains a deeper conditional option: deployment temporary-storage capacity, file-backed Blob compatibility, cleanup, disk latency and peak RSS must be verified before selecting it over this portable bounded-memory path. No serverless storage or infrastructure assumption was introduced.

Opt-in `GET /api/v2/recordings/jobs/:id?compact=1` returns a version-one pending envelope containing job and recording identity, poll URL and retry hint. It avoids the repeated canonical recording projection; the initiating response already supplied that recording. Terminal results retain full playback/review/failure data and account-scoped target decoration. Legacy polling retains the existing full response. Foreground polling keeps its one-second pickup interval; only explicit `background=1` accepts two-to-five-second long-job hints. The SQL read evaluates lease expiry using database time before attempting the existing fenced final-failure update.

Worker instrumentation is disabled by default. With the existing `SAKURA_PERFORMANCE_LOG=1` convention, private authenticated capabilities expose fixed numeric stage/counter aggregates: ownership-fence storage, packet writes, alarms, connection/session work, transfer bytes and admission pressure. No request identifiers, URLs, keys, accounts or raw errors are retained. Disabled instrumentation avoids clock reads and returns the original work value/promise. Ownership transactions, every packet fence, drain interval, chat serialization and the two-transfer Cloudflare limit were preserved. No throughput optimization or infrastructure change was justified without hosted measurements.

Verification completed during implementation:

- 18 media/cache/route/inspection tests passed, including nine new admission, cancellation, byte integrity, failure-bound and compact-status cases.
- An initial 98-test server gate passed, covering promotion identity, upload reuse, wrong tags/bytes, source fallback, leases and exact ranges. The final concurrent gate contained 100 tests: 99 passed, with one newly added ingestion statement-count expectation (`9` actual versus `10` expected) reported to the database owner; media/job/promotion cases passed.
- 72 mocked Node/Cloudflare tests passed, including four new telemetry/HTTP/fence regressions.
- Scoped ESLint had zero errors. Existing worker style warnings remain; generated worker CommonJS files are excluded from the normal lint configuration.
- The client owner additionally reported eight job-poll tests passing, including foreground-delay clamping, compact identity checks, old-response compatibility and cancellation.

Standalone whole-repository TypeScript was run while other subsystem edits were active. An owned media fixture union error was corrected; unrelated in-progress errors were reported to their owners. The final integrated typecheck, production build and browser gates belong to the primary agent. No production build, deployment, migration or live provider request was performed by this workstream.

Final sharing continuation: card font and native PNG waits now have fifteen-second deadlines and independent abort boundaries. Format changes or close release the renderer's canvas while a native callback remains held; late callbacks cannot publish a prepared card. The actual-renderer lifecycle tests passed three cases, and the combined lifecycle/preparation/lyric-sharing gate passed fourteen. Scoped ESLint passed with zero errors or warnings. The new `rebuild-share-performance-browser.mjs` qualifies the shipped dialog with intercepted synthetic APIs, real PNG encoding and a stubbed native share gesture; its current-build execution remains pending until the primary agent finishes the final rebuild. The legacy lyric interaction browser also now requires a loopback origin and blocks external, root/public-share and non-API mutation requests. No temporary application routes are created by these two gates.

Reproduce:

```text
node --import tsx --test scripts/rebuild-media-bounds.test.ts scripts/rebuild-media-cache.test.ts scripts/rebuild-audio-route.test.ts scripts/rebuild-audio-inspection.test.ts
node scripts/test-rebuild-server.cjs
node --test worker/rebuild/service.test.cjs worker/rebuild/serial-queue.test.cjs worker/rebuild/http.test.cjs worker/rebuild/performance.test.cjs worker/cloudflare/deadline.test.mjs worker/cloudflare/tags.test.mjs worker/cloudflare/transport.test.mjs
node --import tsx scripts/rebuild-media-memory-benchmark.ts
node --import tsx --test --test-concurrency=1 scripts/rebuild-share-lifecycle.test.ts scripts/rebuild-share-preparation.test.ts scripts/rebuild-lyric-ui-sharing-performance.test.ts
node scripts/rebuild-share-performance-browser.mjs
```

Use `--sizes=5,30` for a lighter memory comparison. The benchmark never calls real providers or writes audio files.
