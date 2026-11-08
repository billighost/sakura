# Bloom card scrolling

Bloom cards now use permanent, memoized images of the existing authored worlds. The gallery, yearly archive and Home/Discover/Profile shelves retain their artwork while scrolling, during playback updates and when account resources refresh. Cinematic worlds and their five detail levels load when a listener opens the story.

The previous `BloomCover` removed `WorldStage` whenever its intersection observer crossed the viewport margin. Entering the viewport mounted the SVG scenery again, including filters and many illustrated elements. Automatic quality detection also changed card geometry after first paint. The actual 390px baseline recorded 32 card subtree mutations and replaced card children during three scrolling passes.

Cards now display the complete composition at a fixed 4:3 ratio. The original Sakura cover capture also centers its authored lettering and fills the complete canvas, correcting a cropped title and unused lower area.

## Artwork assets

The generator captures each original `WorldStage` opening cover at detail level 5 with still motion and both palettes. It converts those captures into bounded WebP files, writes their dimensions, source and file hashes to [cover-manifest.json](../../src/rebuild/bloom/cover-manifest.json), and updates the versioned asset URLs. No account or database writes are involved.

| Variant | All ten worlds | Largest image |
| --- | ---: | ---: |
| Light, 480 × 360 | 200,578 bytes | 26,046 bytes |
| Dark, 480 × 360 | 198,952 bytes | 26,104 bytes |
| Light, 960 × 720 | 516,898 bytes | 68,498 bytes |
| Dark, 960 × 720 | 511,428 bytes | 66,994 bytes |

All 40 files together occupy 1,427,856 bytes. Responsive selection loads one size in the active palette for each world; repeated instances share the same cached URL. The generator enforces 180 KB per image and 4 MB for all variants.

The final 8 November refresh follows the story layout refinements. Source hashes include each complete world stylesheet, so all twenty world/palette entries were regenerated even though cover and poster selectors remained unchanged. Revision `06efeae23820` passes both freshness regressions. Thirty-seven WebPs are byte-identical to the previous `e7e3bb4d8ce6` set; three have small raster differences. The before/after atlases were visually inspected and retain the original compositions and lettering. The capture route and its directory were removed after generation.

To regenerate, run Next in development mode and use Python with Pillow:

```powershell
$env:SAKURA_TEST_URL = 'http://localhost:3012'
node scripts/rebuild-bloom-covers.mjs
```

The script creates its own temporary `/rebuild/bloom-cover-capture` route, refuses to overwrite an existing route and removes it in `finally`. Concurrent development reloads receive up to two retries. PNG sources remain in ignored `.local/bloom-cover-source`; shipped files are under `public/bloom/covers`.

## Verification

`node --import tsx --test scripts/rebuild-bloom-covers.test.ts` passes two regressions checking every world/palette pair, source and asset hashes, exact decoded WebP dimensions, size budgets, revision URLs and legacy design aliases. Scoped ESLint passes with zero errors or warnings.

`scripts/rebuild-bloom-cover-scroll.mjs` passed against the production build at `http://localhost:3014` in Chromium and WebKit, each at 1280px and 390px. Each browser passed 12 surface/detail checks:

- All 12 gallery covers kept the same wrapper and image nodes across three full scrolling passes and three resource fetches, with zero subtree mutations or additional cover requests.
- Home, Discover and Profile retained their shelf image nodes with zero subtree mutations.
- Both palettes loaded all ten authored images and fit the viewport.
- Opening a Bloom mounted the original rich SVG world; revealing a chapter and closing returned to the static gallery.

Chromium kept the main song playing during gallery scrolling. Windows Playwright WebKit provides no Web Audio, so its two audio cases are explicitly skipped; its gallery, shelf, palette and cinematic detail checks passed. Neither browser reported page errors.

Ignored evidence is under `.local/bloom-cover-scroll`: `before-report.json`, `after-chromium-report.json`, `after-webkit-report.json`, and gallery screenshots for both widths and palettes. Main mobile screenshots include `after-gallery-chromium-390.png` and `after-gallery-dark-chromium-390.png`.
