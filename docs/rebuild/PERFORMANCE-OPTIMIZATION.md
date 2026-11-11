# Mobile performance optimization

Sakura's scrolling pages shared the same React context updates as the audio clock, and its initial client graph included screens and dialogs that were not open. The opening and cinematic stories also spent animation and decoded-image work outside the visible scene. These changes reduce that work while keeping the authored illustrations, music behavior and export quality.

## Changes

- Audio progress now lives in a provider-scoped external store. Timelines, mini lyrics and full lyrics subscribe to it; scrolling pages and song collections do not. Seeking and action-time clock reads remain live. The integration test invokes the real provider through a deterministic React/media adapter: 60 media updates and a seek cause no further provider invocations. The adapter is not a production React profiler.
- Route screens and unopened full-player, lyrics, queue and share dialogs load on demand. The selected route's module loads during account startup. Background prefetch runs serially during idle periods and skips hidden, offline and constrained connections. The neutral offline shell and essential saved-song player chunks remain available offline.
- Feed queues, chapters and hero illustrations have stable memoized inputs. One visibility observer per feed pauses offscreen decoration and hidden-tab motion. Playing petals animate transforms instead of changing height. Native chapter content visibility remains because both engines showed stable scroll anchoring.
- Recognized unsigned Deezer covers expose bounded native responsive variants; unknown, signed and local sources keep their exact URL. Small rows stop downloading original 1000px files. Lazy queue artwork no longer preloads every cover, and only 12 recent full-player sleeves remain retained. Full-resolution song/Bloom exports keep their original artwork.
- The opening keeps all 36 branches, 66 blossoms and 16 departing petals. Each growing blossom uses a bounded compositor layer, the trunk mask shrinks from 1000x760 to 75x400, and the artwork is memoized. Skip, Escape, replay, once-per-tab behavior and reduced motion still work.
- Bloom warms at most six nearby artwork sources instead of the entire chapter archive. Stable scene/world inputs avoid unnecessary SVG rebuilds. Cropped infinite decorative animations pause and resume through one observer per world; finite reveals continue. Closing cancels poster generation.
- Image/link sharing avoids importing and probing video codecs. Video loads its encoder on selection, reuses the prepared PNG, yields between bounded export batches and releases canceled bitmaps/canvases. Bloom poster styling yields in batches and inlines images through four bounded shared requests.

## Measured evidence

The baseline is commit `01851d4`. Before/after production servers used actual Next.js bundles, fonts and authored covers with signed synthetic accounts and intercepted catalog/API writes. The Home sample used a cold 390px viewport at device pixel ratio 2 with service workers blocked. These are resource and functional checks, not physical-phone lab results.

| Measurement | Before | After |
| --- | ---: | ---: |
| Home JavaScript encoded bytes | 335,713 | 285,546 |
| Home CSS encoded bytes | 67,626 | 52,927 |
| Real Deezer 48px thumbnail bytes | 76,244 | 2,978 |
| Artwork requests when entering a 20-chapter Bloom fixture | 20 | 3 |
| Running animations in the settled Bloom fixture | 164 | 95 |
| Rich Bloom SVG node count | 2,619 | 2,619 |
| PNG export fixture bytes | 121,110 | 121,110 |
| WebM export fixture bytes | 216,845 | 216,845 |

The sampled Home resources fell by 14.9% for JavaScript and 21.7% for CSS. The live thumbnail fixture fell by 96.1%. A 312px sleeve still selected 320px/640px at DPR 1/2 in Chromium and WebKit. Export verification decoded the exact selected 880Hz audio, checked dimensions and source text, confirmed zero extra PNG encodes when reusing a prepared card, and exercised cancellation.

The 80-song scrolling regression passed at 320, 390 and 1440px in Chromium and WebKit: zero unintended scroll changes, stable chapter/song DOM, no horizontal overflow and correct animation suspension/resume. Chromium also verified continuing audio. The 37 hero checks covered Home, Discover, Profile, dark theme and reduced motion.

Production mini/full player, lyrics and queue tests passed at 390px with live progress, seeking, keyboard volume and song changes. Bloom's Chromium/WebKit production journeys and delayed preparation/commit/retry/close staging journeys passed. Six 320px multilingual/sparse Bloom poster exports retained 1080x1920 geometry without clipped text. The opening phone regression retained aligned blossom/tree bounds and all interaction behavior.

`npm test` passed 721 checks. `npm run build` passed. Repository ESLint completed with zero errors and 15 warnings. Source-contract tests for the older full personalization/responsive browser suites have stale Bloom labels and native-select assumptions; focused checks exercised the actual current interfaces instead.

Shared machine load made FCP/LCP and animation timings noisy. The paired settled Bloom sample had identical 50ms median and 83.4ms p95 frame intervals. Windows WebKit uses a software rendering environment. These measurements do not establish 60 FPS or a physical Safari frame-time improvement; the supported findings are reduced resource work and passing functional/visual checks.

## Reproduce

Build and start the optimized application, then run the checks against its local production URL. An optional baseline production checkout enables the byte comparison.

```powershell
$env:SAKURA_TEST_URL='http://127.0.0.1:3092'
$env:SAKURA_PERFORMANCE_BASELINE_URL='http://127.0.0.1:3090'
npm run test:performance:browser
node scripts/rebuild-export-smoke.mjs
```

`SAKURA_PERFORMANCE_BROWSER=webkit` selects WebKit for scrolling. `SAKURA_BLOOM_BROWSER=webkit` selects it for Bloom; `SAKURA_BLOOM_PERF_BASELINE=1` records the baseline Bloom without optimization assertions. Reports and screenshots remain under ignored `.local/`.

Development and baseline work used separate checkouts because another agent was editing the original worktree. The performance branch is independently reviewable and preserves those in-progress edits; merge the latest completed PWA changes normally rather than overwriting that worktree.

## Research used

- Installed Next.js 16.4.5 guides in `node_modules/next/dist/docs/`: lazy loading, package bundling, production checklist, server/client boundaries and image behavior. Client-side dynamic imports create the split; dynamically importing a client component from a server component alone does not provide that automatic split.
- [web.dev animation performance](https://web.dev/articles/animations-guide): transform/opacity animations avoid layout work.
- [web.dev content visibility](https://web.dev/articles/content-visibility): offscreen rendering can be skipped while native intrinsic-size memory preserves layout.
- Live public Deezer image requests confirmed the native 96/192/320/640px responses and measured their byte sizes before selecting them in both browser engines.
