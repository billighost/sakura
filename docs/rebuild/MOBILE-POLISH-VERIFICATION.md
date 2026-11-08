# iPhone volume, input focus, and Bloom cards

## Result

iPhone and desktop-mode iPad playback now use a Web Audio gain even when audio
technology is set to `none`. Safari ignores `HTMLMediaElement.volume`; the dry
gain changes audible level without changing the recording or applying effects.
The requested volume survives graph initialization. Main playback and Bloom
chapter soundtracks initialize the context during the listening gesture and use
the authenticated same-asset audio source, avoiding CORS-silenced media. Saved
volume, mute, mode changes, track changes, and pause/resume use the same gain.

Mobile/coarse-pointer text fields, selects, textareas, and editable text have a
16px font floor, including module-specific overrides. The root viewport requests
scale 1 and disables user scaling. The font floor prevents Safari's input-focus
zoom even when the browser ignores viewport restrictions. Hidden controls,
sliders, radio buttons, and audio-file inputs retain their geometry.

Bloom galleries and shared cards use persistent, memoized WebP illustrations
captured from the ten original authored worlds. Both palettes have 480×360 and
960×720 versions. All 40 assets total **1,427,174 bytes**. Fixed 4:3 geometry keeps
the complete composition visible. Scrolling never loads or reconstructs the
cinematic scenes; full stories load when opened. Gallery cards no longer run
cinematic quality detection or a chapter-audio lifetime.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 187 passed |
| `npm run test:sync` | 35 passed |
| `npm run test:audio` | 9 passed, including real audible-output measurements with fixed iPhone media volume |
| `npm run test:bloom:covers` | 2 passed: all world/palette hashes, image dimensions, identity, and size budgets |
| Mobile volume browser fixture | 10 passed: touch, saved gain, mute, interrupted resume, mode/track changes, chapter audio, original playback restoration, and reload |
| Actual-page input checks | Chrome and WebKit: 19 each; zero page errors |
| Production WebKit input checks | 19 passed; zero page errors |
| Production mobile volume | 8 passed on real song, fullscreen player, and settings pages; zero page errors |
| Production Bloom cards/stories | Chrome and WebKit: 12 each at 1280px and 390px; zero page errors |
| TypeScript | Passed |
| ESLint | Zero errors; 11 existing warnings |
| Production build | Passed, 50 pages; temporary capture/test routes absent |

Input checks cover login, registration, searches, onboarding, import, playlist
creation/rename, settings, audio comparison, sharing, readonly URLs, and
textareas. Settings fit 320px, 390px, and 932px layouts; focusing fields preserves
the viewport scale. Radio/file controls remain 1px where intentionally hidden.

The volume fixture uses real media and Web Audio with the iPhone fixed-volume
getter/setter simulated. Native touch changes audible gain and persists the
setting. Measurements confirm mute leaves the source running while output is
silent, and returning to `none` keeps a single source node. Browser/API fixtures
generate their own tone and signed synthetic session and intercept all account
requests; no test account or database mutations are required.

The separate production volume suite measures the actual player at saved gain
0.37, native touch gain 0.19, and settings gain 0.64. It also verifies immediate
Play after cached reload while the session response is delayed by 1.2 seconds;
the listening coordinator keeps that explicit intent.

Before the card fix, three scrolling passes caused 32 cover subtree mutations
and replaced the illustrated children. Production Chrome and WebKit now retain
the same 12 gallery covers and their decoded images with **zero mutations and
zero new image requests**. Home, Discover, and Profile cards remain stable during
scrolling and resource refresh. Both palettes fit; opening a Bloom still mounts
the rich SVG story, reveals its chapter, and closes back to the static gallery.

Windows Playwright WebKit omits Web Audio entirely, including on localhost.
Audio measurements therefore use Chromium. WebKit verifies mobile input focus,
layout, and card behavior. Desktop emulation does not certify physical iPhone
keyboard behavior or Safari's pinch-zoom policy.

## Repeatable checks

Run `npm run test:mobile` against a development server (`SAKURA_TEST_URL`, default
`http://localhost:3012`). The volume test installs a temporary fixture page and
always removes it. Set `SAKURA_MOBILE_BROWSER=webkit` for input and cover checks;
the audio fixture explains unsupported Web Audio builds explicitly.

Regenerate artwork with `npm run generate:bloom:covers` against a development
server, with Chrome and Python Pillow installed. The generator captures the
original opening scenes, encodes bounded WebPs, writes the revision/manifest,
and removes its temporary route. Cover tests require regeneration when original
world artwork changes.

Local evidence: `.local/iphone-volume-chromium-report.json`,
`.local/production-iphone-volume-report.json`,
`.local/iphone-input-chromium-report.json`,
`.local/iphone-input-webkit-report.json`, and `.local/bloom-cover-scroll/`.
