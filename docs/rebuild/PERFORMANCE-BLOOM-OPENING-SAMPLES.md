# Bloom opening sample preparation

The opening previously generated its complete stereo reverb impulse and texture
noise synchronously after the gesture-bound AudioContext resume. The new opening
prepares those exact samples in a Blob worker and copies the prepared arrays into
the real audio graph. Scores, pitches, envelopes, timing and sample arithmetic
remain unchanged. Tests compare all sample bytes at 8, 44.1 and 48 kHz against the
original loops and against the worker/cooperative implementations.

The welcome warms the last known device rate plus the common 44.1/48 kHz pair,
through the same one-generator admission queue. An actual device rate cancels
only unmatched warmups. The common pair retains approximately 2.58 MiB. Resume still occurs
synchronously inside the gesture; graph scheduling awaits real-rate samples and
rechecks active ownership, generation, visibility, mute/pause and context state.
Leaving, pausing or hiding cancels unfinished sample ownership. Independently
owned waits share work without allowing one consumer to cancel another.

Admission allows one active generator and at most four pending identities.
Retained arrays are bounded by both four entries and 8 MiB. Worker completion,
failure, timeout and cancellation terminate the worker and revoke its Blob URL.
Worker source comes from the already loaded client module, so no additional
network script is required offline. Blocked or failed workers use background
tasks with approximately four-millisecond compute slices; they do not fall back
to synchronously generating all samples on the input task.

## Measurements

`node scripts/rebuild-bloom-opening-samples-browser.mjs` tests the current source
in isolated real Chromium. It uses the installed TypeScript transpiler, real Blob
workers, native browser scheduling and an explicit gesture for a real audio graph.
It does not measure production React, account APIs, database or providers.

One five-sample 48 kHz run on the shared Windows host observed:

| Operation | Observed result |
| --- | --- |
| Synchronous sample generation | 38.4–63.9 ms; median 42.2 ms |
| Cold worker completion | 54.7–66.8 ms; median 59.5 ms |
| Warm sample reuse | 0–0.2 ms |
| Long tasks while workers ran | None observed |
| Maximum interval of an 8 ms UI timer | 9.1 ms |
| Retained bytes after five identities | 5,376,000 bytes / four entries |
| Resources after cancellation | Zero workers and zero Blob URLs |

Worker completion is not a claimed total CPU reduction. It moves sample work off
the input/render thread, and warm reuse avoids regenerating it. At the actual
AudioContext rate of 44.1 kHz, first real graph construction measured 107.3 ms.
Five subsequent graphs using the same context and prepared arrays took
45.2–61.3 ms, with a 51.9 ms median. These timings exclude sample generation.
Native ConvolverNode buffer assignment took 45.0 ms cold and 27.2–32.7 ms warm;
copying the samples took only 0.7–1.2 ms. Five PeriodicWave creations consumed
5.0–11.9 ms. Native convolution setup and roughly 196 other nodes/scheduling
therefore remain material costs; this change does not establish that an entire
opening completes within 50 ms. Yielding other node construction cannot eliminate
the synchronous native convolution setup. No score, impulse normalization or
graph architecture was changed to improve these figures.
Raw evidence is `.local/bloom-opening-samples/report.json`.

Nine score/sample/cache/graph tests passed. They cover exact arrays, immediate
cooperative yield, cancellation, shared ownership, admission and retention
bounds, warm reuse and prepared-buffer graph construction. Scoped lint passed.
Production React opening/permission checks remain part of the root integrated
browser gates after its production build.
