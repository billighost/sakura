# Lyrics and player repair, 2026-11-11

This implements `NEXT-SESSION-LYRICS-AND-INTERACTIONS.md`, adds multilingual
readings and official LRCLIB publishing, and prepares a separate hosted timing
worker. The auto-sync service is **not deployed**, and experiments have **not
established accurate full-song synchronization**. The original plain words are
retained on uncertain results. No payment card, paid plan or browser AI model
was configured.

## Causes and repairs

1. **Discovery and caches.** Matching previously required the complete catalogue
   title, including feature, remaster and soundtrack annotations. Search used
   fewer artist variants and did not carry verified alternate titles. Matching
   now folds Latin accents and punctuation, strips only recognized catalogue
   annotations, tries bounded individual credits/title/album queries, and keeps
   significant editions distinct. Instrumental, live, remix, acoustic, language
   version, sped-up and other recording distinctions remain gated. An early
   plain result no longer cancels slower synced providers; LRCLIB also searches
   for timestamps after an exact plain response. Explicit refresh bypasses
   negative caches. Outages stay retryable, misses expire quickly, and an outage
   cannot erase previously verified words. Only the lyric schema was bumped;
   accounts, libraries and offline audio were not cleared.
2. **Reading support.** The controls and requests were Japanese-only. Chinese
   vocal lyrics now receive phrase-aware Mandarin Pinyin using `pinyin-pro`;
   Korean uses `es-hangul` sound rules; Japanese retains its contextual dictionary.
   Cyrillic, Greek, Devanagari and Arabic script transliteration is also offered.
   Kana, Hangul and language hints distinguish scripts; Han alone defaults to
   Chinese with a language selector for ambiguity. Reading choice is shared by
   listening surfaces, account preferences persist, and a late reading response
   cannot overwrite a newer language choice. Original text, timings and sharing
   stay intact. Pinyin is Mandarin, not Cantonese; script conversion is not
   translation and cannot infer unwritten vowels or every name/poetic reading.
3. **Recommendation controls.** The full player now opens the existing
   `TrackActions` taste menu for the current recording, including its existing
   persistence, feedback and recommendation invalidation. Touch/keyboard access
   and song changes reuse those actions.
4. **Shortcuts.** The global guard treated lyric-line buttons as ordinary controls,
   so Space selected/seeks rather than pausing. Lyric lines and transport buttons
   explicitly opt into listening shortcuts; Enter activates their native action.
   Forms, menus, links, sliders and other dialogs keep native keys. Repeated
   Space cannot activate a button twice; IME events remain isolated. Help describes
   this scope and the existing focused-item Shift+F10 options.
5. **Albums.** Missing provider-reference projection and disconnected text-only
   surfaces prevented navigation. A shared accessible album link uses canonical
   album IDs or verified provider references throughout rows/cards, details,
   player, lyrics, queue and downloads. It stops row activation. Browser checks
   exposed another bug: closing a dialog unmounted its Next Link before navigation.
   The router now receives navigation first; route changes clear both overlays.
   Albums without references remain text.
6. **Covers.** Mix detail was disconnected from the existing collage renderer;
   some APIs considered only the first four members, including duplicates/missing
   art. List/detail/offline mixes now derive stable distinct covers across their
   membership. Playlists identify custom covers explicitly and keep them. Broken
   tiles are removed with a remaining-art/empty fallback; album/artist covers stay
   on their existing path.
7. **Collection search.** Existing filters handled basic artist/album text but
   omitted hydrated credits, accents and alternate names, required contiguous
   multiword text, and searched only loaded library pages. A shared local matcher
   searches title, every available credited artist, album, edition and verified
   alternate title with consistent normalization and independent query words.
   Library searches load remaining membership pages, use the existing account
   resource cache and stop automatic retries after a page error. Downloads search
   persisted local metadata offline; no catalogue request is made per keystroke.
8. **Publishing.** Missing lyrics offer a small upload control for plain text or
   LRC. The server authenticates, loads canonical recording metadata, validates
   format/duration/instrumental identity, solves LRCLIB's official challenge,
   publishes with `X-Publish-Token`, and immediately reads that same signature.
   Delayed reads retry briefly and never suggest republishing after success.
   Fresh results update the server/device cache directly; older requests cannot
   overwrite them. Browser publishing tests intercept writes: no test lyric was
   published to the real service.

## Live evidence and its limits

Actual lyric GET handlers were exercised with synthetic authentication and live
Deezer/provider metadata. No library/account writes or audio acquisition were
performed. Eight recordings returned words: the Beatles, David Bowie, Queen,
Teresa Teng, Charlie Puth, Wiz Khalifa, YOASOBI and BTS. Teresa Teng's **甜蜜蜜**
returned synced Chinese lyrics and Pinyin; YOASOBI's **夜に駆ける** returned verified
plain Japanese lyrics with dictionary readings; BTS's **Spring Day** returned
synced Korean lyrics and romanization.

A separate bounded audit used 50 metadata requests (4,454,322 response bytes)
and compared actual LRCLIB search pools with the original selector. Broader
matching recovered candidates for feature/remaster/OST titles including **Hips
Don't Lie**, **Let It Be (Remastered 2015)** and **What Was I Made For? [From The
Motion Picture “Barbie”]**. The captured **My Heart Will Go On (Love Theme from
"Titanic")** pool exposed another narrowly removable soundtrack annotation.
These are real candidate-selection improvements, **not proof that the old full
provider failed every one of those recordings**: other exact candidates already
worked for Starman and We Don't Talk Anymore. Wrong-artist and instrumental
controls remained rejected. Halo's radio edit was not replaced with its original.
The reported 张碧晨 title ends in **伴奏版**; vocal words and upload are rejected
for that instrumental edition. A plain/vocal match is not used to disguise it.

Free sources:

| Source | Integration and availability |
| --- | --- |
| [LRCLIB API](https://lrclib.net/docs) | Public search/get, plain/synced lyrics and official publishing; no key/card. Community coverage varies. |
| NetEase public music endpoints | Existing original-text fallback, independently matched title/artist/duration; no added paid credentials. Regional availability and throttling are outside Sakura's control. |
| [Lyrica](https://wilooper-lyrica.hf.space/docs) | Existing public fallback, accepted only with verifying returned metadata. Cold starts/availability can fail. |
| [lyrics.ovh](https://lyricsovh.docs.apiary.io/) | Added free plain-text last fallback for exact artist/title original editions. It supplies no duration/edition proof, so distinct editions are excluded and timestamps are never invented. |

No source promises words for every song. An incomplete/outage response is not
cached as a proven absence.

## Hosted auto sync

See [worker setup and measurements](../../worker/lyrics-sync/README.md).
The client sends metadata only. The account-bound signed job authorizes analysis
of an existing immutable CDN recording; the worker checks SHA-256, complete size
and decoded duration. It never acquires audio or touches Telegram/download
ownership. The server aligns independent timed English recognition with the
exact original lyrics, rejects uncertain boundaries, and returns text-bound
evidence. Cancellation, account/song changes, stale results, quotas and retries
retain the original words. Accepted local results persist in the lyric cache;
they are not automatically published as community lyrics.

Current [free ZeroGPU rules](https://huggingface.co/docs/hub/spaces-zerogpu) require
a personal account in good standing, a verified email and an account older than
30 days. Eligible accounts can host two Spaces without a paid plan; daily GPU
quotas, queues and cold starts apply. The user confirmed an account older than
one month; email verification and local authenticated access still need to be
established, so deployment remains pending. No paid compute or
credit extension was enabled. This is not unlimited free production compute.

Actual existing Downloads audio was compared with lyrics fetched through the
real GET handler. Native Whisper `small.en` refused Adele's **Someone Like You**
(87.5% recognized-word coverage; 11 uncertain lines) and Ed Sheeran's **Perfect
(Acoustic)** (81.6%; 15 uncertain lines). CPU inference took 238.2 s and 699.2 s
respectively; alignment took 97/116 ms. CPU timings do not measure hosted GPU
latency. Direct `stable-ts` forced alignment recovered more words but still had
zero-duration/low-confidence boundaries. Browser CTC/Whisper tiny experiments
also failed. Their heavy browser dependencies were removed. No accuracy gate
was weakened, no audio was uploaded in these experiments, and no positive
full-song accuracy or instant hosted speed claim is supported.

## Validation and handoff

`npm test` passed 632 checks at the recorded checkpoint; one optional live
PostgreSQL branch requires a database and was not executed. Download regressions
passed 236 app and 57 worker checks. Production build and TypeScript passed;
ESLint had no errors (existing warnings remain). The server test harness was
repaired to preserve transitive fixture paths and resolve installed container
inspection dependencies in its isolated output.

Chrome checks cover real desktop/phone focus, touch, all advertised shortcuts,
native controls, mixed-script readings, taste actions, album navigation, collection
pagination, collage/custom/broken/empty covers, immediate intercepted publishing,
and hosted-sync cancellation/results/failures. Existing Japanese/light/dark/touch,
mobile inputs, custom controls, track presentation and download/Blob checks also
passed. Offline downloads find collaborator-only, album-only, accent and non-Latin
multiword queries without network access. Worker request validation passed four
Python tests. These browser/provider fixtures establish implementation behavior;
they do not prove ML accuracy or a deployed hosted service.

Private raw evidence, full lyric payloads, local audio/model experiments and
screenshots remain in ignored `.local/`. Public evidence contains selected
metadata/results only. Preserve the deployed Cloudflare repair documented in
`CLOUDFLARE-DOWNLOAD-ROLLOUT.md`; no authorization owner was started here.

Remaining work: connect an eligible free hosting account and validate real hosted
singing accuracy/runtime before describing auto sync as reliable. Provider gaps
and uncertain readings remain honest, retryable limitations. Do not lower timing
or recording-identity gates to turn these negative experiments into successes.
