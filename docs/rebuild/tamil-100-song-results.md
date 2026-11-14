# Tamil expansion: 100 additional songs, 2026-11-14

The final corpus checks **115 real Tamil songs**: the original 15 plus 100
additional songs across older and newer composers, singers and films. All 115
independently established short reading guides pass exact comparisons that keep
written vowel length and Tamil consonant distinctions.

The 100 additional songs contribute **7,448 full native lyric lines**, captured
from independently published Tamil/Roman lyric pages. Every source excerpt
occurs in its native capture; all source text and line order remain intact.
The original 15 retain their separate synchronized provider checks across
889 lines. These are different measurements: untimed source pages do not
establish provider synchronization, and full-song processing is not a manual
pronunciation review of every sung word.

## What the larger check changed

The first frozen 100-song pass matched 52 excerpts exactly. Most differences
were preferred initial consonants in words absent from the small reviewed
lookup. The larger corpus also exposed the compound `மின்சாரம்`: its
`மின் + சாரம்` boundary supports `miṉsāram`, rather than automatic postnasal
`j`. Dictionary evidence distinguishes palatal `ஞ் + ச`, which does support
`j`, from alveolar nasal compounds with `c/s` readings.

The final hybrid uses:

- Written Tamil grapheme rules for vowels, pulli, geminates, nasals, laterals,
  retroflexes, Grantha letters and canonical Unicode forms.
- Supported contextual stop voicing, including sonorant continuations while
  preserving historical stop clusters and doubled stops.
- **1,123 exact initial preferences** derived from the human-annotated Dakshina
  lexicon. Every retained preference has at least three unanimous original
  attestations and complete coarse vowel/consonant alignment. Unknown or
  misaligned annotations count against agreement. Broader majority matching
  was rejected after unrelated-word annotations were found.
- **62 exact reviewed source choices**, including protected `c/ch` variants.
  The later curated map has 44 independently corroborated preferred forms,
  three explicitly published preferences with no independent IPA/second-source
  corroboration, and two protected `c` forms. The original 13 choices remain
  ahead of the dataset. None replaces an entire lyric line or song.
- A reviewed `மின்சார-` compound family, retaining its `s` in written noun,
  adjective and inflected forms. Unknown compounds remain conservative.

The displayed guide remains a conventional reading. Spelling alone cannot
determine every compound, loan, dialect or singer's elision. Preferred `c/s`
and voiced initial variants are documented as choices, rather than one
universal phonetic realization.

## Source review and benchmark corrections

Native and printed Roman passages were fixed before engine testing. Capture
hashes and the initial expected-reading hashes preserve that baseline. Two
human benchmark mistakes were corrected from source evidence:

- *Telephone Manipol*: native `மெல்பௌன்` and printed *Melbourne* support
  conventional `melbauṉ`, consistent with existing sonorant stop voicing.
- *Kan Pesum Varthaigal*: written `ன` in `கனிவதில்லை` requires `ṉ` under
  the declared letter convention; informal Latin loses that distinction.

[`tamil-corpus-corrections.json`](tamil-corpus-corrections.json) preserves both
old and corrected expectations, the rationale, source URL and capture hash.
No other expected excerpt changed after the frozen baseline. The audit rejects
unrecorded expectation changes when the baseline capture is available.

Source review also excluded same-title films, unrelated newer songs, duplicated
HTML lyric templates and mostly English/Tanglish text. Full-page line counts
use the first true native lyric container and preserve intentional choruses.
The corpus contains actual source identities rather than inferred movie or
singer credits.

The full pages contain **250 lines with malformed native marks**, including
legacy vowel signs in place of missing letters. Those original source defects
remain visible and are reported separately; valid short accuracy passages
avoid corrupt source spellings. Transliteration cannot certify an intended
word when its native source is malformed. Raw full lyrics remain ignored in
`.local/tamil-100/`.

## Reproduction and evidence

- [`tamil-song-stress-excerpts.json`](../../scripts/fixtures/tamil-song-stress-excerpts.json)
  contains the 100 short native/expected passages and independent references.
- [`tamil-stress-report.json`](tamil-stress-report.json) records source body
  hashes, expected/actual reading hashes, original/order preservation, baseline
  results and the two independently justified corrections. The local detailed
  report also retains short diagnostic readings.
- [`tamil-initials.meta.json`](../../src/rebuild/lyrics/data/tamil-initials.meta.json)
  records all source TSV hashes and original-vote evidence. The independently
  curated choices have their own source/dictionary evidence metadata.
- The Dakshina-derived data carries separate CC BY-SA 4.0 attribution and a
  complete license. The runtime uses a compact local lookup; it downloads no
  model or lexicon and requires no pronunciation API.

```sh
npm run test:readings
npm run test:lyrics
npm run test:readings:live
npm run test:tamil:stress
node scripts/rebuild-tamil-lexicon.mjs --input .local/tamil-dakshina --check
```

`test:tamil:stress` reads the ignored complete source captures produced during
this review. The public short-excerpt regressions run without those captures.
All three Dakshina input hashes are required for reproducible regeneration;
the original dataset's train/dev/test word partitions form the lookup, so its
own test partition is not claimed as a held-out evaluation.

Validation: **196 reading tests**, **152 lyric regressions**, **100/100
additional exact passages**, and **39/39 existing corpus excerpts** pass.
The existing provider audit retains 34 matched full songs / 1,586 lines and
33 independently matching provider passages; all 15 original Tamil provider
passages pass. Existing-language provider gaps and the known Malayalam source
typo remain explicitly reported.

Final optimized production build, including TypeScript, passes. Focused ESLint
and whitespace checks pass. Against that production build, **30 desktop/mobile
Indic and Tamil browser checks** pass, as do the Japanese/Chinese/Korean global
toggle checks in both viewports and the fresh-device delayed-cache regression.
All browser reports have zero page errors. The delayed-cache fixture captures
the already registered IndexedDB completion handler and defers it without
holding native transaction locks; releasing it preserves the mini/full/saved
guides and all original text/times with zero additional reading requests. This
checks background cache completion, not delayed provider result publication.
