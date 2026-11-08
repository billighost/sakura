# Download, library and mini-player verification

Run `SAKURA_TEST_URL=http://localhost:3014 node scripts/rebuild-download-browser.mjs` against the built application. In PowerShell, set `$env:SAKURA_TEST_URL='http://localhost:3014'` before running the script. Then run `node scripts/rebuild-download-browser.mjs --progressive` against the same server to verify the complete application with its production service worker enabled. The older `SAKURA_PROGRESSIVE_ONLY=1` environment option remains supported.

The suite uses the actual library, downloads, queue and lyric screens. It signs a synthetic local session, intercepts its account/catalog APIs and generates playable WAV files with known SHA-256 digests. It writes only that browser's synthetic IndexedDB records and does not insert or update server database rows.

The acceptance checks cover:

- One job for repeated download clicks, concurrent songs and concurrent disjoint chunks within a song.
- Persisted partial bytes through pause, resume and closing/reopening the app tab; completed songs are published only after full-file verification.
- Completed songs as the default downloads view, with activity accessible separately.
- Queue edits changing the next scheduled song while every explicitly requested song still completes. Paused user downloads remain paused during queue changes, and old aborted chunk attempts do not issue retries.
- Independent close/retry controls for unavailable recordings and invalid HTTP ranges, plus cancellation rejecting late completion.
- Persistent list, cards and compact library layouts, keyboard-operated downloads tabs and multilingual filtering.
- The current synced lyric in the mini-player, shared lyric requests with the full lyrics view, and clearing words from the previous song.
- Offline playback of the downloaded Blob, exact SHA-256 of the browser's actual stored artifacts, and responsive light/dark layouts at 390px and 320px.

The machine-readable report and screenshots are written to ignored `.local/download-browser-report.json` and `.local/download-*.png`. The report records the exact queue order and first resumed range request, so a priority failure cannot be inferred from a visual change alone. The delayed route fixture can retain an already canceled request briefly; its raw request-concurrency measurements include those draining requests, whereas the manager's four active chunk limit is verified independently in its engine tests.

Final production acceptance on 2026-11-08 passed thirteen default checks against `http://127.0.0.1:3014`, with zero page errors or unexpected API mutations. Closing the app tab and opening a new tab resumed the stored partial ranges. All seven stored generated-audio artifacts matched their expected full-file SHA-256 digests, and thirteen desktop/mobile screenshots were produced. The queue snapshot placed “A distant shore” before the other two paused requests; after Resume all, its range request started first and all three requests completed. The deliberately delayed route handlers peaked at eight overlapping requests overall and four for one song, including canceled requests still draining; these raw fixture counts do not measure the manager's active four-global/two-per-song concurrency limit.

The production fixture waits for the visible heading of each route because Next 16 can retain an inactive screen's DOM during client navigation. It does not mistake that hidden screen for the current page. All test audio bytes are generated in memory and all test covers are inline SVG data URLs; no external song or cover transfer is needed.

The default application UI scenario blocks service workers so Playwright can control interrupted page fetches deterministically. The `--progressive` scenario enables the production service worker and tests its integration with actual application playback, downloads and saved-song controls. It verifies queue prefixes, preserved position and lyrics on pause, stale media events, resumed and skipped playback grants, and explicit downloads continuing after playback pauses or moves to another song. A separate failure case advances real generated audio, triggers its primary media error and returns HTTP 503 for the media fallback. The terminal failure must revoke access, stop automatic full-file work and retain the last audible position; Play must recover with a new grant from that position.

The progressive scenario also holds an automatic file's transaction-completion callback while Download is clicked through a catalogue alias. The same recording must stay visible in Activity until its requested flag is committed, then appear in Saved songs and remain there after the app tab is closed and a new tab opens. Fullscreen and song-menu controls promote both active streams and completed automatic caches to explicit offline saves. The report at `.local/progressive-integration-browser-report.json` contains the captured job, chunk, grant and completed-file states and the actual saved Blob SHA-256 values. This deterministic storage race affects only the fixture's browser context.

The final progressive run passed all twelve checks against the same production build, with zero page errors or unexpected API mutations and six verified Blob SHA-256 digests. The actual HTTP 503 fallback failure retained a displayed position of 1,800 ms, and successful retry advanced from that position to 2,500 ms with a fresh capability. Revocation assertions follow the affected recording; expiring capabilities belonging to previously closed tabs remain separately isolated. Service-worker registration and control waits are bounded at 15 and 20 seconds, with controller and active/installing/waiting registration states recorded for diagnosis.

Service-worker range mechanics are additionally verified by `scripts/rebuild-partial-playback-browser.mjs`, which runs the production worker and bridge in real Chrome with HTTP media ranges, worker termination/restoration and account revocation.

The complete `npm run test:downloads:browser` verification covers 37 passing checks: thirteen default download/library checks, twelve progressive application checks, six track-layout/mini-lyric checks and six isolated service-worker checks. All four scenarios used the final product source and reported zero page errors; the isolated worker fixture made no gateway fetches.

These generated-audio checks verify transfer and playback mechanics. The separate real-song audit and listening review verify the requested music identity; a generated tone is not evidence that a provider supplied the correct song.
