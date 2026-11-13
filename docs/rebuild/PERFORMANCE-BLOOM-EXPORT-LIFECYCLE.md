# Bloom poster resource lifecycle

The approved B6 change bounds and cancels every poster resource wait: fonts,
animation frames, artwork/FileReader conversion, final SVG decoding and PNG
encoding. Closing an export aborts sibling waits, detaches FileReader handlers,
clears the final image source and canvas, and unmounts/removes the offscreen React
root. Resource deadlines fail visibly instead of silently exporting an incomplete
poster. A sleeve already replaced by BloomArtwork's authored error illustration
remains a valid fallback; a loaded image remains usable when a browser declines
an explicit decode.

The same lifecycle applies to legacy canvas posters. The authored composition,
original-resolution export artwork and 1080 × 1920 output remain in use.

## Baseline and verification

The freshly identified baseline production server on `127.0.0.1:3117` exported
the rich Sakura fixture at a 390px viewport: 1,990,316 PNG bytes, 1080 × 1920
pixels, zero clipped text and zero page errors. Each deliberately stalled resource
stage below retained one offscreen poster root more than three seconds after
Close:

| Stalled stage | Additional retained resource observed |
| --- | --- |
| Fonts | Offscreen React poster root |
| FileReader | Attached load/error/abort handlers |
| Final SVG decode | Image source containing 3,266,283 characters |
| PNG encoding | 1080 × 1920 canvas |

This is a synthetic browser regression measurement, not a production percentile.
Evidence is `.local/bloom-export-review/before/report.json`. All product APIs
were intercepted with a signed synthetic account, and soundtrack files were
generated WAV fixtures; no live account/provider data was modified.

Nine focused Node behavior tests pass in
`scripts/rebuild-bloom-export-lifecycle.test.ts`. They cover late resource failure,
finite deadlines, independent export ownership, background frames, FileReader
cleanup/retry, image decoding, late PNG callbacks and cancellation of the actual
legacy export while fonts remain stalled. Scoped ESLint, browser-script syntax
and owned diff checks pass.

Updated production verification remains a required integration gate. Run
`scripts/rebuild-bloom-export-browser.mjs` with `SAKURA_TEST_URL` set to the updated
local production server, `SAKURA_EXPORT_WORLDS=sakura`,
`SAKURA_EXPORT_WIDTHS=390`, `SAKURA_EXPORT_VARIANTS=rich`, and
`SAKURA_EXPORT_CANCEL_STAGES=fonts,reader,decode,png`. Omit
`SAKURA_EXPORT_BASELINE` for the updated run. It requires every stage to release
its root within three seconds, clear retained resource handles and produce no
download after cancellation; normal exports still check output dimensions,
artwork, complete text and clipping. The complete existing world/width/metadata
matrix remains available by omitting the limiting world/width/variant settings.

## Deliberate compatibility choice

The final embedded SVG retains a data URL. An independent Chromium diagnostic
with an SVG foreignObject rendered through both URL forms produced successful
PNG readback for the data URL and `SecurityError` for the Blob URL. Switching to
the apparently cheaper Blob representation would break this export path.
Cancellation now clears the large data URL promptly; this change does not claim
to eliminate the peak serialization cost of the authored poster.
