# Tamil lyric reading support, 2026-11-14

The subsequent [100 additional song check](tamil-100-song-results.md) brings
the Tamil corpus to 115 and records the final lexical layer and cache versions.
This report preserves the initial 15-song implementation evidence.

Tamil (`ta`) joins the existing 14 reading languages. The implementation uses
a local hybrid of Tamil grapheme rules, supported consonant context and a small
set of reviewed lexical readings. It addresses the earlier Tamil deferral:
`வசீகரா` now reads `vasīgarā`, matching the independently printed *Vaseegara*,
and `முன்பே` reads `muṉbē`, matching *Munbe*. No model, external pronunciation
API or additional package is required at runtime.

The guide retains written vowel length and consonant distinctions while using
conventional contextual readings. It is intended to help readers follow Tamil
lyrics; it is not a narrow phonetic transcription of a particular singer.

## Reading convention and integration

- The 12 vowels retain short/long distinctions, including `e/ē` and `o/ō`.
  Canonically decomposed vowel signs receive the same reading as composed signs.
- Pulli suppresses the inherent vowel. Geminates remain doubled, and formatting
  joiners do not insert vowels or change consonants.
- Distinct written nasals and laterals remain distinct: `ṅ/ñ/ṇ/n/ṉ` and
  `l/ḷ/ḻ`. Retroflex `ṭ/ḍ` and written alveolar `ṟ` remain distinguishable.
- Non-geminate stops use conventional voiced readings after written nasals and
  between vowels. Nasal place is retained: `அன்பே → aṉbē` does not replace
  written `ṉ` with `m`. Intervocalic singleton `ச` reads `s`, palatal
  `ஞ் + ச` reads `ñj`, and geminated `ச்ச` keeps `cc`. The expanded review
  corrected the initial blanket postnasal rule: other nasal-plus-`ச` clusters
  retain conservative `c` unless independent compound evidence establishes `s`.
- Singleton `க/ட/த/ப` also voice after written sonorants within a word.
  Independent `பெய்திடும் → peydiḍum` and `மூழ்கிடும் → mūḻgiḍum`
  checks exposed this rule beyond the initial two-song corpus. Historical
  `ற்` stop clusters and geminates remain intact; sonorant-plus-`ச` retains
  conservative `c` until its reading is established.
- Initial consonants have lexical and dialect variation. Thirteen exact reviewed
  word forms cover supported `ச → s` choices and voiced loans such as
  `பிம்பம் → bimbam`, `கோலி → gōli` and `கீதம் → gīdam`. Only the initial
  consonant is selected; the remaining word retains its normal vowel and
  consonant rules. Unknown forms retain conservative written initials,
  including `c`, conventionally an unaspirated *ch* sound.
- Grantha `ஜ/ஶ/ஷ/ஸ/ஹ`, written `ஃப` for `f`, isolated aytham and OM are
  supported. Unknown signs and combining marks stay visible.

The conventional `g/b/d` readings cover variable surface sounds such as
`g~h`, `b~v` and `d~ð`. Written `ṟṟ/ṉṟ` remain intact because colloquial
simplifications differ by dialect and context. Compounds, borrowed vocabulary,
unwritten vowel changes and singer-specific elisions are not inferred globally.

Tamil participates in the existing native-script detection, language selector,
reading API and saved global transliteration preference. Tamil, `tam`, language
names and BCP 47 hints are accepted. Clear native script wins over unrelated
catalogue metadata; compatible Sanskrit, Badaga and Irula hints suppress an
inappropriate Tamil pronunciation of shared-script text.

The final `multilingual-reading-v5` and `ja-ipadic-hepburn-v4` versions invalidate
old automatic guides, including Japanese-selected mixed lines that previously
left Tamil unconverted. Original lyric text, verified
identity, provider freshness, line/word timestamps and saved manual choices
remain separate from the reading engine. Offline cache upgrades retain the
original lyrics; guides can regenerate after reconnecting.

Implementation: [`tamilReading.ts`](../../src/rebuild/lyrics/tamilReading.ts),
[`language.ts`](../../src/rebuild/lyrics/language.ts),
[`readings.ts`](../../src/rebuild/lyrics/readings.ts).

## Song evidence

The requested corpus contains 15 real Tamil songs. Native and independently
printed Latin passages are selected before running the reading engine. Expected
readings then retain vowel length and Tamil distinctions from the native text,
using the documented hybrid convention. Exact comparisons do not remove the
diacritics that distinguish vowels, nasals or retroflex consonants.

| Song | Recording artist | Full provider lines | Independent passage |
| --- | --- | ---: | --- |
| Vaseegara | Bombay Jayashri | 42 | Passed |
| Munbe Vaa | Shreya Ghoshal / Naresh Iyer | 63 | Passed |
| Kannaana Kanney | Sid Sriram | 71 | Passed |
| Maruvaarthai | Sid Sriram | 65 | Passed |
| Adiye (Bachelor) | Kapil Kapilan | 60 | Passed |
| New York Nagaram | A.R. Rahman | 39 | Passed |
| Thalli Pogathey | Sid Sriram | 72 | Passed |
| Enna Solla Pogirai | Shankar Mahadevan | 57 | Passed |
| Anbil Avan | Devan Ekambaram / Chinmayi | 64 | Passed |
| Rowdy Baby | Dhanush / Dhee | 77 | Passed |
| Moongil Thottam | Abhay Jodhpurkar / Harini | 34 | Passed |
| Pachai Nirame | Hariharan / Clinton Cerejo | 70 | Passed |
| Nenjukkul Peidhidum | Hariharan / Devan Ekambaram / V.V. Prassanna | 63 | Passed |
| Vennilave Vennilave Vinnai | Hariharan / Sadhana Sargam | 52 | Passed |
| Unakkenna Venum Sollu | Benny Dayal / Mahathi | 60 | Passed |

All **15 independent Tamil excerpts pass exactly**. All 15 original recordings
have matched native synchronized provider lyrics and independently verified
Deezer metadata. Their **889 full-song lyric lines** retain original text and
line/word times, detect as Tamil, and leave no unconverted native letters.
Each independently checked passage also passes within the actual provider text.

Fixture sources and exact expected excerpts are recorded in
[`reading-song-excerpts.ts`](../../scripts/fixtures/reading-song-excerpts.ts).
The dated [`transliteration-report.json`](transliteration-report.json) records
per-song excerpt results, provider/catalogue identities, capture timestamps,
replay flags, source hashes and full-song preservation checks. Raw lyrics and
independent page captures remain ignored in `.local/tamil-reading-research/`.

Independent excerpt accuracy and full-song processing measure different things.
For each provider match, the audit processes all lyric lines, verifies native
language detection, checks for remaining source script and compares original
text, line times and word times. The expected source passage must also occur in
the provider lyrics for a live excerpt accuracy check to pass. Processing a full
song does not amount to a manual pronunciation review of every word.

Sources sometimes disagree. The early checks found `குழு/குளு` and
`சிநேகம்/ஸ்நேஹம்` variants in *Vaseegara* and *Munbe Vaa*. Faithful readings
retain the provider's spelling; transliteration does not silently repair lyric
text. The existing Malayalam *Darshana* provider typo `സധാ` versus reference
`സദാ` likewise remains a source mismatch, not a certified pronunciation match.
*New York Nagaram* uses literal Latin `Newyork` in the provider while the
independent native source uses `நியூயார்க்`. Its accuracy fixture checks the
next two matching Tamil verse lines; the full-song reading preserves the Latin
spelling. Stable later verses likewise avoid the independently recorded source
typos in the opening lines of *Kannaana Kanney* and *Vennilave*.

## Hybrid research

[Harold Schiffman's Tamil grammar, University of Pennsylvania](https://ccat.sas.upenn.edu/plc/tamilweb/book/chapter1/node20.html)
describes the written/spoken transliteration distinction, postnasal voicing and
variable intervocalic stops. Its [stops](https://ccat.sas.upenn.edu/plc/tamilweb/book/chapter1/node15.html)
and [voiced consonants](https://ccat.sas.upenn.edu/plc/tamilweb/book/chapter1/node17.html)
chapters provide supporting context. The [Unicode Tamil encoding chapter](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-12/)
supplies the grapheme and canonical-encoding basis.

| Alternative researched | Finding and decision |
| --- | --- |
| [Epitran Tamil](https://github.com/dmort27/epitran/tree/master/epitran/data) | The inspected Tamil letter map and postprocessing rules lack contextual stop voicing. Adding its Python dependency would not resolve the previous pronunciation gap. |
| [AI4Bharat IndicXlit](https://github.com/AI4Bharat/IndicXlit) | Native-to-Roman inference is available in an approximately 11-million-parameter model. Its published Tamil top-1 Aksharantar scores are 45.08% for native words and 35.46% for named entities. These word benchmarks do not measure lyric pronunciation, and the Python/fairseq model does not establish this guide's precise vowel-length convention. It was not adopted as an authoritative runtime reading engine. |
| [Google Dakshina](https://github.com/google-research-datasets/dakshina) | Human-attested Roman word pairs and counts were identified as a possible larger lexical layer. The subsequent 100-song expansion adopted 1,123 strictly filtered exact initial preferences with source hashes, attribution and the complete CC BY-SA 4.0 license. See the expansion report for the selection rules and limits. |

Nine successful dated research captures, with URLs, byte counts and hashes,
are retained in `.local/tamil-hybrid-research/captures.json`. These support the
choice of a deterministic local hybrid with reviewed lexical exceptions and
conservative unresolved readings.

## Validation

The pre-change reading suite passed 66 tests, including all 24 independently
checked song excerpts across the existing 14 languages. An independent replay
also processed 19 captured full songs / 697 lines with unchanged readings,
preserved text/timing fields and no remaining native script. That replay used
dated provider captures, not fresh network responses.

The initial Tamil integration passed 79 reading tests, including its two initial
song excerpts and 11 dedicated Tamil regressions. Lyric selection, interactions,
sync, publication and studio regressions passed all 152 tests. A fresh initial
audit matched 21 full provider songs among the then-26 excerpts, with no
correctness failures; these are interim results before the requested expansion.

- Reading regressions: **94 passed**, including 39 actual-song excerpts across
  all 15 supported languages and 13 dedicated Tamil tests. The corrected
  New York native-equivalence fixture also passed its focused revalidation.
- Lyric selection, interactions, sync, publication and studio: **152 passed**.
- Final provider audit: **39/39 independent excerpts**, **34 matched full songs
  / 1,586 lines**, **33 passing provider passages**, zero correctness failures.
  All 15 Tamil provider passages pass. Five existing-language recordings have
  no verified provider match, and the known Darshana source typo prevents its
  independent passage match; these are reported rather than counted as passes.
- The fresh capture rounds fetched **78 catalogue/provider GETs** on
  2026-11-14 UTC. Final revalidation replayed those successful captures after
  validating URL, age and SHA-256, with zero further GETs. The audit permits
  at most 96 requests, 8 MiB per run, 1 MiB per response and four minutes.
- Browser integration: **30 checks passed**, desktop light at 1440 px and mobile
  dark at 390 px, with zero page errors. Tamil mini/full/full-lyrics rendering,
  global enable/disable, saved offline reuse, native-only v3 cache upgrades and
  exactly one reconnect guide request all pass. Browser persistence checks wait
  for the asynchronous IndexedDB write before asserting saved identity/timing.
- TypeScript, focused ESLint and the final optimized production build pass.

Reproduction commands:

```sh
npm run test:readings
npm run test:lyrics
npm run test:readings:live
node --import tsx scripts/rebuild-indic-reading-browser.mjs
npm run build
```

The browser script uses the real Sakura UI and local reading engine with short
checked excerpts, generated audio and intercepted provider/account routes. It
tests the global preference, mini/full lyric views, persistence and offline
migration; it does not measure physical-device audio or live-provider access.
