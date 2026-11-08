# Personalized feed verification

This document records the first implementation pass. The integrated refinement,
connected onboarding/Search, and ten-world Bloom evidence are recorded in
[`SECOND-PASS-VERIFICATION.md`](./SECOND-PASS-VERIFICATION.md).

Verified on 8 November 2026 after the final copy revision, fragment navigation fix, and compact data confirmation. The comprehensive browser suite passes **29 checks with no uncaught browser errors**. Production build, TypeScript, scoped ESLint, and the server/data tests also pass.

## Browser acceptance

Run an authenticated Sakura development server, then:

```powershell
$env:SAKURA_TEST_URL = 'http://localhost:3014'
node scripts/rebuild-personalized-feed-browser.mjs
```

The test signs a synthetic account token and intercepts its product API responses. Representative recording cards, measured listening fixtures, and a generated 90-second WAV make the run deterministic. It creates no real listener account and changes no real listener's preferences, history, or collection. Artwork in this fixture uses existing Sakura Bloom assets.

| Area | Verified behavior |
| --- | --- |
| Home and Discover | Distinct screens, recommendation explanations, direction controls, and observer pagination that retains existing songs and removes overlapping IDs. |
| Feed settings navigation | Clicking “Tune your feed” changes the route and brings the actual settings heading into the nested music viewport. |
| Smart playback | “Find my soundtrack” creates an ordered queue and actually starts its first complete WAV recording. Queue continuation preserves the current audio source and manual picks. |
| Downloads | Only verified device recording IDs are submitted. An injected unsaved API result is rejected. With browser networking disabled, local generation starts playback from a saved blob without a suggestion request. |
| Taste controls | Canonical recording IDs and correct day, week, month, and permanent suppression choices reach the API. Exclusions can be undone. |
| Preferences | Presets, finer sliders, time-of-day personalization, and learning controls persist their account settings. |
| Data ownership | Confirmation fits its content, focuses “Keep my data,” retains keyboard focus, and sends no deletion on cancellation. Confirmation submits exactly the selected scope and period and emits account invalidation events. Export downloads a JSON copy. |
| Listening profile | Day selection, hour selection, published genres, and measured listening statistics render and respond to interaction. |
| Responsive presentation | Home, Discover, Profile, and Settings have no horizontal overflow at 1440, 390, and 320 pixels. Dark Home and reduced-motion mobile presentations are included. |

External catalog and CDN availability are outside this intercepted browser fixture. The playback checks prove the actual client queue and audio behavior using complete fixture audio; the listening graphs show controlled measurements rather than production listener statistics.

## Server and retained-data evidence

The database suites exercise real PostgreSQL service functions in isolated temporary schemas with owned account and recording fixtures. Complementary client and synchronization tests verify evidence delivery and playback:

- `scripts/rebuild-personalization-db.test.ts` verifies stable feed pagination, account boundaries, active exclusions, eligibility, scoped queues, and concurrency/deletion behavior.
- `scripts/rebuild-personalization-data.test.ts` verifies sequence-aware stopping positions, receipt compatibility, audible-time accounting, reversible taste expiry, selective clearing, retained-summary reconciliation, and rejection of delayed deleted events. It also verifies timezone/calendar calculations and unknown dates for retained imports.
- `scripts/rebuild-listening-outbox.test.ts` verifies cancellation and account isolation when clearing pending listening, including delayed storage writes.
- `scripts/rebuild-listening-evidence.test.ts`, `scripts/rebuild-player.test.ts`, and the listening-sync tests cover audible evidence, strict saved-source playback, preserved manual choices, playback context, and session restoration.

The browser's mocked deletion is therefore separate from the database deletion evidence. User likes, playlists, preferences, and device audio are retained by the data-clear operation. Time-limited deletion cannot assign dates to older imported aggregates; the confirmation explains that “All time” clears those undated totals too.

## Visual review and artifacts

Final copy and wrapping were reviewed on desktop and both mobile widths. The full decorative phrase “music, with room to breathe” was checked using its text bounds: it remains 15.75 pixels inside the desktop hero and about 6.8 pixels inside the 390/320-pixel heroes.

The local report is `.local/personalized-feed-browser-report.json`. It records all 29 checks and references 18 screenshots, including:

- `.local/personalized-desktop-home-light.png`
- `.local/personalized-desktop-home-dark.png`
- `.local/personalized-desktop-discover-light.png`
- `.local/personalized-desktop-profile.png`
- `.local/personalized-desktop-profile-insights.png`
- `.local/personalized-desktop-clear-confirmation.png`
- `.local/personalized-mobile-390-home.png` and the corresponding feed, Discover, Profile, and Settings images
- `.local/personalized-mobile-320-home.png` and the corresponding feed, Discover, Profile, and Settings images

The confirmation screenshot was recaptured after its entrance animation settled. A targeted recapture is available without repeating the acceptance suite:

```powershell
$env:SAKURA_TEST_URL = 'http://localhost:3014'
$env:SAKURA_CAPTURE_CLEAR = '1'
node scripts/rebuild-personalized-feed-browser.mjs
```

Local images and fixture reports remain excluded from source control; the repeatable scripts and verification documentation are retained.
