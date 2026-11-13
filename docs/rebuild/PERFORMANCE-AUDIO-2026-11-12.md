# Audio preparation and queue performance

Implemented against `5229fdb` on 12 November 2026. These measurements use generated local PCM, the actual sample loops and deterministic media/provider adapters. They do not establish deployed latency, physical audio startup, codec decode time or production percentiles.

The preview now measures loudness and raw waveform peaks in one pass. It preserves the former BS.1770 accumulation order and exact measurement output. One dialog owns one module worker, one active analysis job, at most four waiting jobs and a weak cache of small results keyed by immutable source buffers. Source PCM is copied in bounded blocks and transferred to the worker; the original AudioBuffer is preserved. Cancellation terminates active worker work, and closing the dialog stops queued work and yielding fallback analysis. Unsupported workers use the same sample algorithm with regular yields. Native OfflineAudioContext rendering remains responsible for the sound filters.

The corrected browser benchmark ran on an intercepted HTTP origin in Chrome `157.0.8103.78`, with three samples per mode and 24 seconds of generated 48 kHz stereo PCM. The prior mode executes the unchanged two analyses and two waveform scans. The first worker mode dispatches two analyses and creates the gained waveform from the small peak result. The warm mode reuses the cached original measurement and dispatches only the enhanced measurement. The benchmark excludes HTTP, audio decoding, native filter rendering, actual settings UI and physical output. The JSON artifact records the source hashes and measurement time.

| Browser main-thread CPU setting | Prior synchronous loops, median / range | First worker pair, median / range | Cached original, median / range |
| --- | --- | --- | --- |
| 1x | 610.4 / 552.7–655.4 ms | 563.3 / 549.2–613.5 ms | 281.7 / 267.3–380.2 ms |
| 4x | 3,230.0 / 3,215.9–3,386.7 ms | 712.3 / 697.1–765.9 ms | 369.6 / 357.4–421.1 ms |

The ten-millisecond timer received zero callbacks during every prior synchronous sample. It received 55–61 callbacks during the first worker pair at 1x and 27–38 during the warm pair; native worker messages confirmed that the fallback was not used. This demonstrates scheduling responsiveness in this fixture. DevTools CPU throttling does not establish equivalent throttling of dedicated workers, so the 4x elapsed comparisons are not claimed as constrained-device speedups. The harness reported no Long Task entries, including for the known blocking prior loops; those fields are not reliable evidence and are excluded from conclusions. The earlier `data:` document run also failed to provide reliable worker/timer evidence and is deliberately not used.

Settings preview source ordering prefers the exact attached Blob, then an account-scoped canonical complete save with matching ready checksum, before remote fallback. Metadata preflight reads container duration, channels and sample rate without allocating decoded PCM. A 256 MiB working forecast includes full PCM resampled at the actual AudioContext rate, two encoded copies, three excerpt/render/transfer buffers and the weighted prefix. This preserves the existing eight-minute 48 kHz stereo source allowance with a twenty-MiB encoded file; the separate ninety-six-MiB retention/analysis limit is not treated as a hard source limit. Actual native decoded dimensions are checked again before excerpt allocation. The full decoded song does not remain in the async excerpt-analysis frame.

If a first offline preview cannot load the optional demuxer chunk, or that demuxer cannot inspect a browser-supported format, a metadata-only Audio element probes the Blob without playback. It has a finite deadline, cancellation, source detachment and object-URL cleanup. Native metadata does not reveal channel geometry; that result explicitly marks the stereo/context-rate forecast as estimated. The native decoder remains an uncancelable browser operation, and postdecode validation cannot prevent that initial browser allocation. Clip-aware decode remains conditional on proven codec/time/sample compatibility and belongs to the sharing workstream; no speculative decoder was enabled here.

The next-occurrence helper reserves a stable queue occurrence for preparation and eventual navigation, follows the existing manual/repeat policy and returns live canonicalized metadata without rerolling. Empty autoplay results use a bounded generation-specific 2/4/8/16-second retry gate; new choice/reconnect can clear it. Neither helper truncates the runtime queue. The new recording-index helper retains all chosen candidates, deduplicates only identical expected identities, skips known canonical tracks, and sends sequential groups of at most fifty and 32,768 UTF-8 bytes. A two-thousand-reference fixture produces forty requests. Complete response validation and cancellation precede canonical publication; the authenticated route validates the entire group before ingestion.

Job polling opts into the version-one compact pending envelope while retaining the initiating canonical recording. It verifies job/recording identity and the exact same-origin poll path. Foreground completion pickup stays within one second; only explicitly background polling permits longer hints. Existing completion, playback/review/failure, account isolation, total deadline and cancellation behavior remain.

Completed verification before integrated final gates:

- Nine planner/DSP/worker tests, six batch-index/route tests and eight job-poll tests passed before the native metadata addition. This includes a real module worker, exact loudness/waveform parity, source ownership, cancellation, UTF-8 bounds and malformed response rejection.
- The added real-Chromium offline metadata case passed with zero playback and no retained object URLs after success or active cancellation. The affected ten-case audio run passed nine cases; the previously passing real-worker case hit its sixty-second timeout under shared-host contention and requires a serial rerun.
- Existing audio technology tests passed nine cases, with one Windows WebKit case skipped for absent Web Audio support; real Chrome filtering/gain/timing cases passed. Preferences passed three cases.
- The updated real MusicProvider harness passed 164 of 171 cases before central integration fixes. The seven failures exposed three new exact-next/hidden-work regressions, three existing reconnect synchronization regressions and an offline local-preparation regression; they were reported to the central owner instead of weakening assertions. Final integrated counts belong to the primary report.
- Scoped ESLint passed for the owned helpers and tests, including the final native metadata and playback fixture changes. Whole-repository lint, TypeScript, production worker bundling/offline behavior and complete browser verification belong to the primary integration gates.

Final continuation rerun: all ten cases in `rebuild-audio-performance.test.ts` passed in a sequential 51-case audio/lyrics/index/job/share batch. This includes the formerly timed-out real module-worker case and native offline metadata success/cancellation. These two Chromium fixtures use intercepted synthetic origins and generated PCM; they do not replace the settings UI, production worker bundling, physical output or offline application qualification.

Reproduce:

```text
node --import tsx --test scripts/rebuild-audio-performance.test.ts scripts/rebuild-recording-index-batch.test.ts scripts/rebuild-recording-jobs.test.ts
node --import tsx --test scripts/rebuild-audio-technology.test.ts scripts/rebuild-playback-integration.test.ts
node scripts/rebuild-audio-performance-browser.mjs
```

The benchmark writes `.local/rebuild-audio-dsp-performance.json`. Run browser/production gates sequentially on an idle host. No live ingestion, provider request, deployment, migration or infrastructure change was performed by this workstream.
