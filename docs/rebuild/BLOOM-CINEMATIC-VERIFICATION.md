# Cinematic Bloom release verification

Verified 7 November 2026 against the combined production build, including the
completed audio technology and account synchronization work.

All ten worlds are implemented: Sakura Afterglow, Rainforest Reverie, Velvet
Disco, The Lantern Book, River of Ink, Painted Courtyard, Monsoon Miniature,
Tidal Dream, Paper Cosmos and Prismatic Garden. Their opening cards, drawn
title lettering, scene illustrations and PNG keepsakes match the selected
world. Five quality tiers offer automatic device selection and a manual
override in Settings.

The shared story includes ranked recording artwork and complete artist
credits, leading artists and their actual songs, listening-time comparisons,
single-action progression, optional autoplay, pause, reading mode and saved
progress. Snapshot tests retain sequential disclosure and legacy support.

## Final checks

| Check | Result |
| --- | --- |
| `npm test` | 187 passed |
| `npm run test:sync` | 11 passed |
| `npm run test:audio` | 7 passed, including real Chrome signal rendering |
| `npx tsc --noEmit --incremental false` | Passed |
| `npm run lint` | Zero errors; 11 image, hook, navigation and directive warnings |
| Production `npm run build` | Passed with system CA certificates and `.next-bloom-build` |
| Complete cinematic browser journeys | All ten worlds at 1280px and 390px passed |
| Selected-world loading | All ten initial story routes loaded only their selected world JS chunk |
| `git diff --check` | Passed |

Each of the 20 browser journeys used a rich synthetic listening history with
15 chapters, multilingual credits, illustrative covers and local audio. The
checks covered sequential reveals, duplicate-input protection, completion,
all facts in reading mode, illustrated 1080x1920 PNG exports, horizontal
overflow and zero page errors. Account and API mutations were intercepted.
Rapid arrow events are dispatched in one browser task so the check measures
inputs arriving during the same pending reveal rather than driver latency.

The final visual review confirmed the repaired Sakura and Cosmos framing,
Japan masthead, and China's portrait painting, title and silk edges. Poster
composition uses a fixed 540x960 layout before rendering at twice its size.

## Performance evidence and limits

The production manifest contains ten separate world imports. Their compressed
JS plus CSS totals range from 8,368 to 13,089 bytes per world, excluding the
shared app, director, lettering, recording imagery and audio. Browser resource
checks verified a single selected world chunk on each initial story route;
the ten-world gallery intentionally loads the worlds it displays.

The earlier integrated Rainforest motion profile at 390px with fourfold Chrome
CPU throttling measured a 25ms median and 49.9ms p95 frame interval over 44
samples, 2,512 SVG nodes and approximately 24.8MB of JavaScript heap. Manual
pause, hidden-tab pause and soundtrack pause passed. Reduced-motion final
journeys had no running animations. These are desktop Chrome measurements,
not a physical-phone frame-rate or compositor-memory certification.

## Reproduction and local evidence

Build and serve with `SAKURA_BUILD_DIR=.next-bloom-build`; set
`NODE_USE_SYSTEM_CA=1` for the local build certificate chain. The normal
production default remains `.next`. ESLint ignores `.next*` build folders.

With the production app at `http://127.0.0.1:3013` and the existing local test
session fixture, run:

```text
node --import tsx scripts/rebuild-bloom-cinema-smoke.mjs
```

`SAKURA_TEST_URL`, `SAKURA_BLOOM_WORLDS` and `SAKURA_BLOOM_WIDTHS` select the
server and matrix. `SAKURA_BLOOM_PROFILE=1` enables the motion profile.

Ignored local evidence includes `.local/bloom-cinema-review/report.json`,
scene screenshots and 20 exported posters; `.local/bloom-lazy-review/report.json`
records the selected-world chunk checks. Build and lint logs are
`.local/final-build.log` and `.local/final-lint.log`. Private session fixtures,
audio sources, generated builds and browser artifacts are excluded from Git.
