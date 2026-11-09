# Playback, lyrics and iPhone SE navigation

Verified on 9 November 2026 alongside the completed Bloom openings.

## Reproduced failures and corrections

- A reopened partial download made another catalog lookup before attaching its
  already saved audio. A lookup outage therefore prevented playback of those
  chunks. The account's download manager now exposes its exact persisted asset,
  checksum, size and canonical gateway. Playback joins that asset without another
  lookup; chunk integrity checks and explicit source refreshes remain in place.
- Joining playback could demote an explicit full download to playback cache mode.
  A requested download now retains full mode and finishes saving independently
  of playback and pause.
- WebKit can run the rejected Play promise's callbacks between native error
  listeners. The fallback could load first, clearing MediaError, then the old
  event stopped the new transport and displayed the reported connection error.
  Native error events now require a current MediaError. A queued event cleared
  by loading the replacement cannot stop it. The promise-first regression failed
  before the correction and passes afterward.
- The open lyrics dialog's retained scroll position was clamped while the next
  song's lyrics loaded. That layout scroll incorrectly disabled following.
  Follow now distinguishes browsing gestures from layout changes, resets for a
  new queue occurrence, and still resumes when the current verse returns into
  view. The delayed-lyrics browser regression failed before the correction.
- The mobile shell used only CSS viewport height. It now tracks visualViewport
  height and offset, including standalone windows that differ from the layout
  viewport. Navigation and the mini player stay attached to the visible edge.

## Verification

- `npm run test:downloads`: 225 application tests and 55 worker tests pass.
- Lyrics and follow tests: 58 pass; the provider integration suite: 100 pass.
- The combined production build compiles all routes and passes TypeScript.
- Focused ESLint passes with no errors; eight existing MusicContext warnings
  remain outside these corrections.
- The production Chrome browser fixture passes six scenarios: error/promise
  fallback ordering, a first chunk delayed beyond 12 seconds, reopened partial
  playback during a lookup outage, delayed lyrics after browsing and Next,
  subsequent lyric following, and iPhone SE navigation with/without the mini
  player, resizing and a distinct visual viewport.
- An additional generated MP3 starts from its saved prefix in Chrome during
  the lookup outage, while the recording remains incomplete.
- WebKit passes the 320 x 568 lyrics and navigation scenarios. Physical iPhone
  PWA playback was not available for verification. Windows WebKit rejects the
  service-worker media range in the progressive fixture with NotSupportedError,
  despite receiving a verified 206 response. The stale-error correction prevents
  that rejection from falsely stopping the replacement; it does not claim to
  change the Windows media backend's supported sources.

Browser fixtures use synthetic signed account APIs and generated audio. They
never forward product mutations to the database. Reports and screenshots remain
private under `.local/`.

Run the browser fixture against a local production server:

```powershell
$env:SAKURA_TEST_URL='http://127.0.0.1:3014'
node scripts/rebuild-playback-startup-browser.mjs

$env:SAKURA_TEST_BROWSER='webkit'
$env:SAKURA_STARTUP_SCENARIOS='mobile-nav,lyrics-change'
node scripts/rebuild-playback-startup-browser.mjs
```

The fixture accepts an optional generated MP3 through SAKURA_AUDIO_FIXTURE for
format checks; its default is an internally generated WAV. Bloom verification
is recorded separately in BLOOM-OPENINGS-VERIFICATION.md.
