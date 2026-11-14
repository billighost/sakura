# Lyric transliteration expansion, 2026-11-14

Added **Telugu, Kannada, Malayalam, Odia, Serbian and Georgian**, bringing the
supported reading languages to 14. Hindi now distinguishes nasalized vowels
from consonant nasals and handles equivalent nukta and conjunct spellings.
Japanese, Mandarin Chinese, Korean, Russian, Ukrainian, Greek and Arabic remain
supported. Tamil, Bengali, Punjabi/Gurmukhi, Gujarati, Marathi and Nepali were
assessed and deferred for the reasons below.

Every added language uses the existing saved global **Enable transliteration**
preference across songs, Settings, mini player, full player and full lyrics.
Both legacy preference fields continue to represent the same choice, including
an explicit disable and account/offline restoration. Existing defaults are
preserved. The removed per-line "reading needs review" label stays absent, and the
existing botanical mute design remains intact.

Original lyric text, line and word timestamps, recording verification, saved
lyrics and provider freshness remain independent of pronunciation engines.
The verified-lyrics schema and saved lyric identity are unchanged. Readings are
additional fields; an upgrade removes obsolete guides locally while keeping
the original saved lyrics available offline. Guides regenerate after reconnect.

The Indic implementation uses the maintained, typed, MIT-licensed
[`@indic-transliteration/sanscript` 1.3.3](https://github.com/indic-transliteration/sanscript.js)
and its ISO 15919 maps. The release was published on 2025-06-08; npm metadata was
updated on 2026-04-10. Its own documentation warns that it is Sanskrit-focused
and has partial modern-language support, so availability of a script table was
not sufficient to enable a language. Modern-language adjustments were checked
against independent song text and script/phonology references.

Telugu and Kannada retain inherent vowels, short/long e and o, retroflexes,
conjuncts and gemination. Anusvara becomes the homorganic nasal before the
appropriate stop and final m. Malayalam additionally handles atomic and legacy
chillus, equivalent AU spellings, explicit half-u and unambiguous stacked
alveolar conjuncts. Formatting joiners before virama select the Malayalam
ligature style without changing its reading. These distinctions follow
[Unicode 17, chapter 12, section 12.9](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-12/).
Odia retains medial and final inherent vowels and equivalent nukta spellings.
ISO `a` represents Odia /ɔ/; it does not denote Hindi schwa.

Serbian uses standard Serbian Latin, preserving `č/ć`, `dž/đ` and upper/title
case digraphs. Georgian uses the national system adopted in 2002, also used by
BGN/PCGN since 2009. Ejective apostrophes remain meaningful: `კ/ქ` become `k'/k`,
and `წ/ც` become `ts'/ts`. Modern Mkhedruli and Mtavruli letters are supported;
historical letters outside the table remain visible. References:
[Serbian Latin](https://en.wikipedia.org/wiki/Gaj%27s_Latin_alphabet) and
[Georgian national romanization](https://www.eki.ee/wgrs/v2_2/rom1_ka.htm).

Language detection uses native lyric text and compatible ISO 639, language-name
or BCP 47 hints. Unrelated metadata does not override clear native script.
Devanagari alone does not establish Hindi: a trusted Hindi hint or distinguishing
Hindi words are required. Shared possessives such as `तुझे` and `मेरा` are
insufficient. Marathi, Nepali and Sanskrit hints suppress automatic Hindi
conversion. Shared Cyrillic needs a compatible Russian/Ukrainian/Serbian hint or
distinguishing evidence; `Моя мама` alone remains ambiguous. Serbian `љ/њ/џ/ј`
also occur in Macedonian and do not establish Serbian on their own. Known
unsupported shared-script hints, including Bulgarian/Macedonian,
Persian/Urdu, Cantonese and Mingrelian/Svan/Laz, prevent inappropriate
conversion. Unsupported predominant scripts stay original even when they
contain a short supported-language refrain.

The new Indic alphabets also have shared-script guards: Sanskrit hints suppress
automatic Telugu/Kannada/Malayalam/Odia guides; Kannada-script Konkani/Tulu,
Telugu-script Gondi/Koya and Odia-script Santali hints keep those unsupported
languages original. Their alphabets alone cannot justify a supported-language
label, and those languages have no validated two-song support corpus here.

Mixed lines convert supported script spans separately and preserve Latin text,
punctuation, emoji and unknown characters. Reliable source hints travel through
reading requests and normalized transform cache keys, so a Marathi span cannot
borrow a previously cached Hindi result. The v3 reading upgrade records whether
a language was detected or chosen, retains known manual selections, and removes
old automatic Hindi/Russian guesses when current evidence is insufficient.
Legacy v2 data did not record provenance: a choice identical to its old automatic
detection cannot be distinguished from that automatic choice and is redetected.

A browser regression exposed an older asynchronous lyric load overwriting a
completed guide in the mini player. Each view now adopts the latest shared
lyric snapshot when that load finishes, preserving completed guides and newer
published lyrics without another reading request.

Each added language has **two actual-song excerpt tests** with expected readings
chosen from independent native/Latin references or an independently applied
established romanization table. Sources and exact expectations are in
[`reading-song-excerpts.ts`](../../scripts/fixtures/reading-song-excerpts.ts).
The added-language and Hindi comparisons preserve vowel length, nasalization,
retroflex distinctions and ejective apostrophes. Expectations are not generated
from the implementation or adjusted to match provider errors.

| Language | Actual songs and excerpt checks | Live native lyric evidence |
| --- | --- | --- |
| Hindi, improved | Arijit Singh: **Tum Hi Ho**, **Channa Mereya** — both pass | Channa Mereya matches, including its independent excerpt; Deezer lists Pritam/Arijit as Main contributors. Tum Hi Ho's queried lyrics are Latin, leaving a Devanagari provider gap. |
| Telugu, added | Sid Sriram: **Inkem Inkem Inkem Kaavaale**, **Samajavaragamana** — both pass | Samajavaragamana matches Sakura's existing title/artist/edition gates and its excerpt passes; no independently matched catalogue duration was available. Inkem has conflicting editions and is withheld by the recording gates. |
| Kannada, added | Sonu Nigam: **Anisuthide**; Vijay Prakash: **Bombe Helutaite** — both pass | Both native matches and independent live excerpts pass, with separately matched catalogue durations. |
| Malayalam, added | Vijay Yesudas: **Malare**; Hesham Abdul Wahab/Darshana Rajendran: **Darshana** — both pass | Both native provider recordings match catalogue durations. Malare's independent live excerpt passes. Darshana's provider spelling differs from the checked excerpt; its full transformation is verified, but that provider phrase is not counted as a pronunciation pass. |
| Odia, added | Satyajeet Pradhan/Aseema Panda: **Bande Utkala Janani**; Kuldeep Pattnaik: **Ahe Nila Saila** — both pass | Ahe Nila Saila matches **Kuldeep Pattnaik**, and its live excerpt passes. The composed-song reference describes Bhikari Bal; his recording was not substituted with Kuldeep's. Bande's queried provider response is empty. |
| Serbian, added | Dušan Jakšić: **Tamo daleko**; Nikola Urošević Gedža: **Bože pravde** — both pass with trusted Serbian hints | Bože pravde matches catalogue duration and its live excerpt passes. Tamo daleko has no matching native provider lyrics in the bounded queries; broader research returned Latin/instrumental candidates. |
| Georgian, added | Nino Katamadze & Insight: **Suliko**; Niaz Diasamidze: **Tbiliso** — both pass | Both native matches and independent live excerpts pass with catalogue durations; Tbiliso also exercises a Mtavruli initial. |

Existing-language regressions also cover Teresa Teng's **甜蜜蜜** and
**月亮代表我的心**, 程響's **世界這麼大還是遇見你**, YOASOBI's
**夜に駆ける**, Kenshi Yonezu's **Lemon**, BTS's **Spring Day**, Кино's
**Группа крови**, Софія Ротару's **Червона рута**, Anna Vissi's **Δώδεκα**
and Amr Diab's **Tamally Maak**. All ten excerpts pass. Nine have native live
matches and passing live excerpts; Червона рута retains its catalogue-duration
and edition ambiguity.

The full audit therefore passes **24/24 independent excerpts** across 14
languages. It processes **19 native provider matches**, with **18 passing
independent live excerpts**, no correctness failures, unchanged original text
and line timing, and zero remaining target-script lines in the generated
guides. These captures have no word timestamps; preservation of populated word
timestamps is checked separately in the regression fixtures. Eighteen native
matches have separately matched Deezer catalogue
durations; Samajavaragamana has the narrower identity scope described above.
Darshana's LRCLIB text writes `സധാ` (`sadhā`) where the independent reference has
`സദാ` (`sadā`). The source and its faithful spelling guide are preserved. This
provider passage cannot establish the independently expected pronunciation.

Live catalogue/provider GETs and local excerpt tests are separate evidence.
The last fresh audit fetched 48 responses / 3,535,773 bytes on 2026-11-13 UTC.
After the final Unicode changes, the audit reprocessed those captures with zero
new GETs, validating capture URL, successful HTTP status, age and body hash.
[`transliteration-report.json`](transliteration-report.json) records capture
timestamps, replay flags, provider/catalogue identities, source hashes, per-song
results and the narrower recording scopes. Full raw lyrics remain ignored in
`.local/`. The bounded audit allows at most 64 GETs, 8 MiB total, 1 MiB per
response and four minutes; `--refresh` requests new live captures. Plain-lyric
audit lines use synthetic positions solely to test field preservation; they
are not claimed as provider synchronization.

The remaining Indian candidates require more than script tables:

| Candidate | Reason support is deferred |
| --- | --- |
| Tamil | Context, vocabulary and dialect affect `ச` and stop voicing. **Vaseegara** (`வசீகரா`) has the established reading *Vaseegara*, while plain ISO gives *vacīkarā*. Position-only rules do not resolve all c/s and loan exceptions. A maintained lexicon or verified reading layer is needed. |
| Bengali | Inherent /ɔ/ raises to /o/ or disappears according to context; conjuncts have lexical readings. **Amar Sonar Bangla** and **Ekla Chalo Re** expose these gaps in plain table output. Assamese shares the script and needs separate evidence. |
| Punjabi/Gurmukhi | Addak, nasal marks and final-vowel rules are insufficient for morphology-dependent internal schwa deletion and lexical tones. `ਕਾਗ਼ਜ਼` (*kāġaz*) becomes *kāġzā̃* in `ਕਾਗ਼ਜ਼ਾਂ`; historic voiced aspirates are not ordinary modern aspirated stops. **Laung Laachi** and **Tunak Tunak Tun** were assessed, but passing their hooks would not validate general pronunciation. Gurmukhi also writes non-Punjabi sacred language. |
| Gujarati | Schwa deletion depends on morphology. **Mor Bani Thanghat Kare** needs deletion in `થનગાટ`, while **Vaishnava Jana To** retains the internal vowel in `જનની` (*jananī*). A generic deletion rule damages one of these independent examples. |
| Marathi | Hindi rules wrongly delete vowels in words such as `प्रेरणा` and `केतकी`; final anusvara can denote a nonnasal schwa, as in `फुलं`. Affricate variants and vocabulary require Marathi-specific knowledge. Shared Devanagari is insufficient. |
| Nepali | Final vowels and suffix boundaries differ from Hindi: `आज` retains final a, while attached `उसको` is *usko*. Noun/verb/postposition rules and lexical exceptions need a Nepali engine; shared Devanagari is insufficient. |

Assessment references include
[Indo-Aryan schwa deletion](https://en.wikipedia.org/wiki/Schwa_deletion_in_Indo-Aryan_languages),
[Gujarati phonology](https://en.wikipedia.org/wiki/Gujarati_phonology),
[Gurmukhi](https://en.wikipedia.org/wiki/Gurmukhi),
[Tamil phonology](https://en.wikipedia.org/wiki/Tamil_phonology) and the
[Library of Congress Odia table](https://www.loc.gov/catdir/cpso/romanization/oriya.pdf).
Independent source captures and detailed assessment notes remain in
`.local/indic-indoaryan-research/`, `.local/indic-dravidian-research/` and
`.local/additional-language-research/`.

Other practical candidates were also assessed. Bulgarian has a usable official
romanization system, but only one independently checked song was established
here, falling short of the two-song gate; shared Cyrillic requires a trusted
Bulgarian hint and its own mappings. Macedonian similarly needs its own standard
and vetted two-song corpus. Armenian needs Eastern/Western pronunciation
evidence and schwa handling. Thai needs word segmentation, contextual vowels
and tones. Unvowelled Hebrew, Persian and Urdu omit necessary short vowels and
need a maintained lexical/contextual engine or verified guides; Persian `گل`
can mean *gol* or *gel*. Latin-script Turkish, Vietnamese and Indonesian already
need no script conversion, and their useful diacritics should remain intact.

These are established spelling/reading guides rather than IPA or singer-specific
phonetic transcriptions. ISO `c`, `ś`, `ṣ`, `ṅ` and `ṇ` require familiarity with
the convention; vowel length and retroflex distinctions are deliberately kept.
Malayalam bare final virama can represent an unwritten reduced u, and old
`ററ`, `ൻറ` or `ന്‍റ` are ambiguous; the engine does not guess those readings.
Odia modern sibilants and Sanskrit conjuncts can differ from ISO spelling, and
regional singing may delete vowels retained by standard Odia. Hindi lexical
schwa and fricative/nasal exceptions remain. Serbian Latin does not encode pitch
accent or vowel length; Georgian does not infer singer assimilation. Mandarin
Pinyin does not cover Cantonese, every proper name or poetic reading. Arabic
transliterates written vowels and consonants without inventing omitted sung
vowels. Two excerpts and full-song preservation checks do not amount to manual
pronunciation review of every word or physical-device audio measurements.

Verification:

- `npm run test:readings`: 66 passed, including actual songs, shared-script hints,
  preference persistence, cache migration, recording/word times and mixed lines.
- `npm run test:lyrics`: 142 passed across lyric selection, interactions, sync,
  publication and studio regressions.
- Additional cache/player/preferences/PWA/audio regressions: 121 passed and one
  Windows WebKit Web Audio capability skip. Chrome audio/native mute checks pass.
- The final Malayalam control-equivalence regression passes; the final audit
  revalidation retains all 24 excerpt passes and 19 live transformations.
- Production browser checks pass on desktop light (1440 px) and mobile dark
  (390 px): 28 added-language/Hindi/Japanese checks plus the deterministic
  delayed-load regression, with zero page errors. The regression holds an older
  IndexedDB JavaScript completion after its native transaction lock is released;
  mini/full/saved guides retain original text and line/word timestamps with zero
  extra reading requests after release, reopen or same-language publication.
  Evidence: `.local/indic-transliteration-browser/report.json` and
  `.local/indic-transliteration-browser/fresh-device-race-report.json`.
- Existing Japanese/Chinese/Korean global-toggle browser checks pass in both
  viewports. Seven browser cache regressions also pass, including offline engine
  migration, delayed reads and publication/auto-sync ordering.
- All 15 Chromium iPhone capability/audio checks pass, including native mute,
  measured enhanced output, saved volume, the botanical pressed state, touch
  targets and reduced motion. This fixture creates a temporary page on the
  isolated development server; the lyric browser checks use the production
  server. Physical iPhone speaker/AirPods output is not measured.
- TypeScript and the optimized production build pass. Full ESLint reports zero
  errors and 23 existing warnings; focused changed-file lint passes.

The browser tests use the real UI and local reading engine with short checked
song excerpts, generated audio and intercepted provider/account routes. Offline
tests disconnect providers while keeping the app shell available. Their results
are browser integration evidence; the separately dated provider captures above
supply the live lyric evidence.
