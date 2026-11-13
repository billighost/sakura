# Multilingual lyric readings, 2026-11-13

The reading repair was checked against 11 short excerpts from actual songs in all
eight supported languages. All 11 now match independently chosen readings.
Nine songs also have live original lyric captures selected with Sakura's strict
title, artist, edition and independently fetched Deezer duration gates. The
original words and every timestamp remain unchanged in those full-song runs.

Transliteration now has one saved account preference across supported languages.
The previous Japanese and other-language flags had separate behavior; either
existing enabled choice now carries forward, and new controls save both compatible
fields together. Turning readings on for Japanese also enables Chinese, Korean,
and the other supported scripts. Settings has an **Enable transliteration**
switch. Full-player and lyric controls share it, and the per-line review label
and review caveats have been removed. Saved original lyrics survive the v2
pronunciation-engine upgrade; obsolete guides regenerate after reconnecting.

The shared volume button now has a rose-and-ink pressed state, a drawn quiet
stroke and settling petals. Native iPhone playback keeps device volume and uses
the media element's mute control, with **Muted** feedback and restoration of the
previous player level. Saved reduced motion and device motion preferences disable
the animation.

| Language | Actual songs checked | Live original lyrics |
| --- | --- | --- |
| Mandarin Chinese | Teresa Teng: 甜蜜蜜 and 月亮代表我的心; 程響: 世界這麼大還是遇見你 | All three matched; independently checked phrases pass, including Traditional Chinese |
| Japanese | YOASOBI: 夜に駆ける; Kenshi Yonezu: Lemon | Both matched; independently checked phrases pass |
| Korean | BTS: Spring Day | Matched; independently checked phrase passes |
| Russian | Кино: Группа крови | Matched; independently checked phrase passes |
| Ukrainian | Софія Ротару: Червона рута | Excerpt passes; provider edition ambiguity remains because the catalogue returned no independently matched duration |
| Greek | Anna Vissi: Δώδεκα | Matched; independently checked phrase passes |
| Hindi | Arijit Singh: Tum Hi Ho | Devanagari excerpt passes; live candidate responses contained Latin lyrics, so they cannot prove Devanagari conversion |
| Arabic | Amr Diab: Tamally Maak | Matched; written-script excerpt passes; missing sung vowels are not inferred |

The excerpt checks caught real baseline defects: Traditional Chinese 麼/還 were
read as *mó/huán* in the 程響 phrase; 甜蜜蜜 used stressed *dé* for the neutral
complement particle 得; Lemon split the long vowel in でしょう as *desho u*;
Ukrainian и was read using the Russian mapping; Greek ου became *oy*; and the
Hindi line omitted several spoken inherent vowels. The fixed readings now pass
assertions independently of provider availability. Arabic uses scholarly
written-script transliteration, including the ayn and written long vowel in
معاك; it does not invent vowels absent from the source.

Verification:

- `npm run test:readings`: all 39 focused quality, real-song, preference and cache
  tests pass. The wider reading/lyrics regression run passes 119 tests.
- Desktop light and mobile dark browser checks pass with zero page errors:
  Japanese-to-Chinese/Korean transitions, shared Settings/lyric controls, reload
  and fresh-device restoration, and all-language disable. Evidence is in
  `.local/transliteration/report.json`.
- The iPhone capability simulation passes 15 audio/browser checks, including
  native mute/unmute, measured enhanced audio output, saved volume, the artistic
  pressed state, 44-pixel touch targets and reduced motion. Evidence is in
  `.local/iphone-volume-chromium-report.json`. Physical iPhone speaker output
  was not measured.
- Seven browser cache checks pass, including offline lyric retention through
  the engine upgrade and regeneration of obsolete guides after reconnecting.
- TypeScript and the optimized production build pass. ESLint reports zero
  errors; existing warnings remain in the shared MusicContext.
- `node --import tsx --test scripts/rebuild-reading-songs.test.ts`: 12 tests pass.
- `node --import tsx scripts/rebuild-reading-live.ts`: 11/11 independent excerpt
  checks and 9/9 live phrase checks pass; all nine full-song transformations
  preserve original text/timing and leave zero original supported-script lines.
- [Machine-readable results](transliteration-report.json) contain provider IDs,
  catalogue IDs, capture timestamps, source hashes and limits. Raw full lyrics
  remain in ignored `.local/` files.

The session used 24 bounded catalogue/lyric GET requests and 1,967,491 response
bytes across discovery and verification. No audio, account changes or lyric
publication were requested. Subsequent checks reuse the captured responses;
`--refresh` requests a new bounded provider audit.

These results demonstrate the checked phrases and transformation invariants,
not manual pronunciation review of every word in every song. Pinyin is Mandarin;
Cantonese, names and poetic readings can differ. Some Ukrainian sentences need a
verified language hint because their Cyrillic letters overlap Russian. Hindi
lexical schwa exceptions and unwritten Arabic dialect vowels remain outside a
deterministic script conversion.
