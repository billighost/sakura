# Bloom openings continuation

Recovered and continued on 9 November 2026 from the Bloom enhancement conversation
`01a1bedf-a57e-7d42-8dde-90879127d724` and the unfinished opening conversation
`01a1bf5b-a028-7f61-8660-83dd67813199`, including its five implementation agents.
The later greeting conversation contained no additional implementation work.

## Behavior

Every visit presents the illustrated welcome before the saved chapter. Merely
showing the welcome leaves the bookmark and factual reveal frontier untouched.
Enter Bloom restores the unfinished story's saved position; completed stories and
explicit replay begin at chapter one. Chapter buttons, arrow keys, and swipes
cannot bypass the entrance. Skip opening settles the decorative animation while
leaving entry explicit. Reduced motion and quality one show the complete still
artwork immediately.

The openings belong to the existing vector worlds, so no generated raster asset
or downloaded soundtrack is required:

| World | Entrance |
| --- | --- |
| Sakura | A luminous seed unfolds into a blossom and ink-drawn orchard |
| Jungle | Veined leaf shutters reveal a river and drifting fireflies |
| Disco | Velvet curtains part onto a mirrored dance floor |
| Japan | A bound lantern book opens and its companion joins the spread |
| China | A glowing lacquer book opens in darkness, turns leaves, and releases cranes |
| Korea | Gilded screen panels unfold into a painted courtyard with a magpie |
| India | A gilt folio and jewel lotus open into a miniature garden |
| Ocean | A pearl rises into the moon above the illustrated tide |
| Cosmos | Folded paper machinery opens into the celestial observatory |
| Glass | Stained-glass petals assemble into a luminous window |

Each world has an original deterministic instrumental score synthesized through
Web Audio. Browser gesture permission is respected; Play opening music provides
an explicit action when needed. Mute, scene entry, closing, and hidden route
cleanup release the audio context. Pause or native context suspension preserves
musical time. A finished score stays finished until an explicit replay action.
These decorative scores never produce listening receipts.

## Corrections found during continuation

Next 16.4.5 with Cache Components preserves page state through React Activity.
The initial production browser run reproduced a client revisit that returned
directly to chapter four. The director now resets transient entrance state in
layout-effect cleanup when its route becomes hidden, preserving the durable
bookmark. It also advances request generations monotonically so late reveal
responses cannot revive a hidden journey. The resumed chapter's song can start
again after the previous audio session has closed.

The opening audio hook now distinguishes passive gesture unlock from explicit
musical replay and follows native context suspension when scheduling completion.
Its retained completion and manual-stop flags reset on a fresh Activity entrance.
Japan's ink title and Ocean's painted title keep their settled appearance instead
of restarting older title animations when the opening phase changes.

## Verification

- Existing Bloom suite: 101 tests passed.
- Opening score suite: three tests passed for ten distinct scores, deterministic
  seeded composition, bounded notes, and legacy design resolution.
- Real Chrome audio hook checks passed natural completion, passive replay
  suppression, explicit replay, a 19-second suspension across the old deadline,
  mute/unmute, pause/resume, scene transfer, rejected permission, and late resume.
  All seven durable cases also cover Activity revisits after natural completion,
  active playback, and manual closing.
- The final production build compiles all routes and completes its TypeScript
  check; build ID `cLpvFX5QH4Y917u1MVwBl`.
- Focused ESLint checks pass with no errors or warnings.
- All 40 distinct world/width/motion browser journeys pass: the initial matrix
  passed 37, and a six-case targeted rerun passed after correcting three fixture
  timing failures. The fixture now records entrance phases inside the browser
  and handles Skip becoming unnecessary when the entrance settles. Original
  failures remain in `initial-matrix-report.json`; the targeted run remains in
  `rerun-report.json`; `report.json` aggregates the 40 verified combinations.
  Every case checks untouched welcome bookmarks, gated navigation, explicit
  saved entry, sequential next reveal, sound cleanup, client revisits, browser
  back/forward, and horizontal overflow. Reduced motion has no running animation.

The visual review checked all ten desktop compositions and available phone
frames. Japan's corrected title remains visible through settled and entering
frames. Early animation screenshots have approximate labels: under renderer
load, screenshot capture can finish after the phase advances, so those labels
do not certify precise animation timing.

Results and frames are written to `.local/bloom-opening-review/`; audio evidence is in
`.local/bloom-opening-audio/`. Browser API calls are intercepted with synthetic
authentication and audio, so these checks do not create database listening data.

Run `npm run test:bloom:openings` for score tests. Start the app on port 3013 and
run `npm run test:bloom:openings:browser` for the full UI matrix. Override
`SAKURA_TEST_URL` for a different server. The matrix uses all ten worlds at 1280
and 390 CSS pixels with full and reduced motion.
Use `SAKURA_BLOOM_CAPTURE=0` to run functional checks without screenshot overhead.
Run `npm run test:bloom:opening-audio:browser` for standalone native-audio
lifecycle checks; it needs no server or authentication configuration.

## Handoff

The opening continuation is complete and verified locally. The built application
is available on `http://127.0.0.1:3013`. The earlier Bloom enhancement is already
in commit `f4b94f7`; opening work remains in the working tree. Concurrent edits
outside the Bloom opening files belong to other ongoing work and were preserved.
Persistent Mesh access is unavailable because the installed
CLI supports schema version 3 while this project's database uses version 6.
No database changes or privacy bypass were attempted. This document preserves
the recovered scope and continuation findings on disk.
