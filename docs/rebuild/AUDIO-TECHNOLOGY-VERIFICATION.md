# Audio technology verification

Verified 7 November 2026. Sakura Settings now offers None, Clarity, Warmth,
Punch, Night and Headphones. Preferences persist through the existing account
and offline settings paths. The live player and preview share the same DSP.
See [research and sources](AUDIO-TECHNOLOGY-RESEARCH.md) for the decisions.

## Listening preview

The local preview at `http://127.0.0.1:8766` uses 0:42–1:06 of Ayra Starr's
“Commas” from the user's Downloads folder. Six PCM WAVs were rendered locally.
All use one common measured loudness target, -14.3574 LUFS. The original source
remains unchanged; files and browser evidence stay in ignored
`.local/audio-technology/`. The normal Settings preview also accepts a local
audio file or the current song. Its A/B gain matching is per selected pair.

Independent FFmpeg loudnorm measurements of the exported files:

| Mode | Integrated LUFS | True peak dBTP |
| --- | ---: | ---: |
| None | -14.32 | -4.57 |
| Clarity | -14.30 | -3.34 |
| Warmth | -14.34 | -3.74 |
| Punch | -14.34 | -3.87 |
| Night | -14.35 | -4.55 |
| Headphones | -14.32 | -4.20 |

The browser meter and output guard use sample peaks. The independent FFmpeg
true-peak check above applies to these particular exported files; it does not
certify a universal live true-peak limiter.

## Passed checks

- `npm run test:audio`: 7 tests pass. Real Chrome signal tests cover bypass
  identity, gated K-weighted loudness, finite output, mono-compatible crossfeed,
  compressor timing, post-DSP volume/mute and rapid branch retirement.
- Actual Settings UI: desktop light, 390px dark and 320px light pass all modes,
  shared position/seek, single active lane, Space/Escape/focus, save, file errors,
  cancellation/recovery, and page/dialog overflow checks; no page errors.
- Actual MusicProvider playback: 7 scenarios pass, including native None with
  no AudioContext, same-asset gateway migration with preserved position and
  measured nonzero signal, safe later sources, volume/mute, account isolation,
  and saved Night activation on first Play.
- Standalone song preview: 1440px, 390px and 320px pass all modes, position
  preservation, seek/pause and no overflow; no page errors.
- Scoped audio TypeScript and ESLint pass. Authenticated development example
  metadata and WAV endpoints both return 200. Production returns 404 for the
  local example endpoint.

## Shared workspace checks

The final combined production build and global TypeScript check pass after
all ten Bloom worlds were completed. `npm test` passes all 187 tests,
`npm run test:sync` passes 11, and `npm run test:audio` passes 7. Full ESLint
reports zero errors and 11 warnings. The earlier missing world imports and
legacy Bloom rotation failure are resolved. See
[cinematic release verification](BLOOM-CINEMATIC-VERIFICATION.md).

## Reproduction

`npm run preview:audio` regenerates all six local comparison WAVs and the local
HTML from `.local/audio-technology/source.wav`. The source must be a mono/stereo
excerpt of at most 30 seconds. Serve that directory locally to audition it.
`npm run test:audio` needs the locally installed Chrome used by this project's
browser checks. The additional smoke scripts use the isolated app at port 3004
and the preview server at port 8766; playback fixtures intercept account writes.
