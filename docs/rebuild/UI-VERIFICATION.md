# Browser interaction verification

Checked on 2026-11-07 against the rebuilt application at `http://127.0.0.1:3002` using Chrome. The isolated Next.js development server uses `.next/dev`; the existing production server on port 3000 was preserved.

## Queue, touch, fullscreen listening

`scripts/rebuild-touch-smoke.mjs`: **6 variants passed** — 320px, 390px and 1440px in light and dark mode.

- Manual additions form a FIFO section ahead of contextual music, including duplicate recording occurrences.
- Arrow buttons, mouse dragging and native Chrome touch events reorder the exact occurrence. The grip explicitly disables browser panning so touch capture is not cancelled.
- Removing one duplicate preserves the other. Clearing manual and automatic future songs leaves the current song and source playing.
- Next plays the manual selection. Queue mutations update the runtime immediately.
- Anchored popovers fit narrow screens, manage keyboard focus, navigate with arrows, and return focus after Escape. A completed hold opens options; movement cancels the hold.
- Full player and lyrics occupy both viewport dimensions. Synced line taps seek correctly, the guide follows within its own scroll surface, and line selection remains separate from following.
- Artistic volume controls mute and restore volume. A simulated 503 HTML response produces an actionable notice inside the native dialog; retry saves the favorite, and raw exception text is absent.
- Cancelling a delayed recording lookup leaves the audio paused with no source; retry resolves and plays the selected song instead of resuming the previous recording.
- Failed playlist lookup and song addition recover inside the anchored options menu. The mocked 503 responses expose no diagnostic text, and retry completes the requested addition.
- Artist names in the options heading remain navigable even without a catalog artist identifier, using an artist-filtered search.

Pure queue helpers also pass **4 focused tests** in `scripts/rebuild-queue.test.ts`.

`scripts/rebuild-player-mobile-smoke.mjs`: **4 variants / 16 dialog views passed**, including long queues, exact move/remove, focus, no horizontal overflow, and selected lyric PNG preparation. The stress fixture is paused so its 30-second audio does not finish while inspecting the dialogs.

## Production Bloom flow

`scripts/rebuild-bloom-production-smoke.mjs`: **2 production UI variants passed** — 390px light and 1440px dark.

- Available, locked and empty recap states lead to the appropriate actions.
- Chapters hide statistics and associated music until revealed.
- Revealing a chapter plays its related recording in a separate audio element and pauses the underlying player.
- Muting/re-enabling the soundtrack works. Stale media events from stopped audio cannot create an unavailable-song message.
- Reopening a cached recap preserves its current revealed chapter, as intended.
- Completing the six chapters succeeds. Closing restores the previous player and keeps its queue.

## Independent expiry and account-cache regression checks

`scripts/rebuild-bloom-recovery-smoke.mjs` passes a deterministic Chrome clock
check at 390px. A live dialog closes when its viewing deadline passes. A 410
retry clears its persisted snapshot; full navigation fetches again and cannot
reopen the expired cached story. A completed yearly story has a working archive
revisit link and opens even after its ordinary expiry date. The report is
`.local/rebuild-independent-review-report.json`.

`scripts/rebuild-preference-boundary-smoke.mjs` verifies a failed account A
appearance save is never replayed into account B after the browser reconnects.
Only A's changed theme field is sent; server revision metadata is omitted.
`scripts/rebuild-resource-race-smoke.mjs` holds the initial Bloom response while
a setting change invalidates it. The browser makes two reads and displays only
the new response. Both checks intercept synthetic-account APIs and perform no
real account or database writes.

`scripts/rebuild-resources.test.ts` passes five focused cases: obsolete response
discard, coalesced invalidations, expired-data eviction with stable recovery
copy, account-clear cancellation, and metadata-free preference patches.
Scoped ESLint and full `tsc --noEmit` pass after these changes.

## Action recovery and contributor navigation

The final scoped audit replaced unbounded mix playback, playlist creation,
playlist rename and library pagination requests with the common bounded JSON
request helper. Their failures retain a direct retry action. Appearance saves
retry their intended patch, and a failed sign-out offers another attempt.
Song-menu playlist actions preserve HTTP status classification and show
recovery inside the menu so outside-click dismissal cannot strand a retry.

Album results, song options and public shared cards expose individual artist
links; identifiers lead to artist profiles and missing identifiers lead to an
artist-filtered search. The touch suite covers the song-menu fallback link and
both playlist action failures at all six responsive/theme variants.

## Evidence and limits

Reports and screenshots live under the ignored `.local/` directory:

- `rebuild-touch-report.json`
- `rebuild-player-mobile-report.json`
- `rebuild-bloom-production-report.json`

These checks use live synthetic authentication with explicitly mocked catalog, recap and audio responses. They verify the production UI and actual browser audio/canvas behavior. Real provider matching, production recap generation and physical device performance require their separate backend/device checks.
