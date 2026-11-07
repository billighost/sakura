# Lyrics and Japanese readings audit

The previous Japanese converter made a reading choice independently for each kanji. This cannot reliably read compounds, inflected verbs, particles, names or the alternative readings used in songs. The replacement in `src/rebuild/lyrics/` uses a morphological dictionary, preserves the original text and timings, and supports exact-span reviewed readings. The authenticated `/api/v2/lyrics` and `/api/v2/readings` routes are connected to the fresh production Sakura Ink player and sharing studio. The findings below refer to the original code, archived during the rebuild.

## Findings in the current application

| Severity | Evidence | User-visible consequence | Replacement behavior |
| --- | --- | --- | --- |
| High | `src/lib/transliterate.ts:572`, `:588`, `:631` walk characters and guess between individual Unihan on/kun readings. | Compounds and words such as 大人 and 今日 can have incorrect readings. The existing fixture even expects 夜に駆ける as “yo ni kakeru,” although the song title is “yoru ni kakeru.” | Whole-word IPADIC tokenization through kuromoji. Kana conversion through wanakana; particle は/へ/を become wa/e/o when morphology identifies them as particles. |
| High | `src/app/api/transliterate/route.ts:93` keys the cache by script, track ID or “adhoc,” and line count. | Different songs or edited lyrics with the same number of lines can receive the wrong song's cached reading for up to 30 days. | SHA-256 of complete ordered text, reading-engine version and reviewed-reading revision. Track ID is an additional namespace, not a substitute for the input. |
| High | `src/app/api/lyrics/route.ts:104` asks Lyrica for `romanize=true&language=en`; `src/lib/lyrics.ts:376` accepts `romanized` verbatim. | A translation can be displayed as pronunciation without checking its script or provenance. | Japanese language checks on provider data; readings produced from Japanese source text, with source-span verified kana overrides for reviewed/authorized alternatives. |
| High | `src/app/api/lyrics/route.ts:189` always selects the highest-scoring search result, even with zero agreement. | Wrong title, artist, version or duration can become the lyrics for the selected song. | Fail closed on title, artist, language and duration mismatch. Expose missing/ambiguous rather than returning unrelated lyrics. |
| Medium | `src/app/api/lyrics/route.ts:99` awaits all four providers before returning any successful source. | A fast exact LRCLib response still waits for a slow provider and its retry. The comment describing an early-return cascade does not match the implementation. | Exact lookup returns immediately; search happens only when the exact match fails. A total timeout bounds the request. |
| High | `src/lib/lyrics.ts:403` borrows word timings by nearest time without checking text. | Words from a different version can be attached to the chosen lyric line. | Matching text and start time are both required before borrowing word timings. |
| Medium | `src/lib/lyrics.ts:51`, `:73` parse only one line tag; blank timestamped lines are dropped. | Repeated chorus timestamps and instrumental breaks are lost, so highlighting can drift or stay on a previous line. | Fresh parser handles multiple timestamps, offsets, empty timed lines and enhanced word timestamps. |
| Medium | `scripts/check-transliteration.ts:140` prints mismatch counts without setting a failing exit status. | A check can look successful to CI while readings disagree. Some expected values describe existing errors. | Assertive Node test suite; every mismatch fails the process. |
| Medium | `src/lib/lyrics.ts:310` returns any IndexedDB lyric object for a track, with no provider/content version. | Previously wrong lyrics or readings remain indefinitely after a server correction. | New cache namespace/version must accompany integration, and old lyric/readings cache entries must be invalidated. |

## Replacement modules

- `japanese.ts`: server-only dictionary initialization with a shared promise; pronunciation-aware particles; long vowels retained; source tokens and offsets; unresolved kanji flagged; exact-source reviewed reading overrides; content-hashed cache keys. It does not import the legacy transliterator.
- `provider.ts`: typed provider/recording contracts; title, artist, duration and Japanese-language gates; explicit missing, ambiguous and unavailable outcomes; exact lookup first; album/duration/language-sensitive cache identity.
- `parse.ts`: multi-timestamp LRC and offset handling; instrumental blank lines; original absolute word timings; text-verified merge; binary search that respects empty/gap lines.
- `corpus.ts`: thirty real song titles and known artist/title aliases only. No full lyrics are committed.
- `service.ts` and `request.ts`: new bounded resolver cache with concurrent request deduplication; short missing-result TTL; uncached outages; validated request limits and timing fields.
- `scripts/rebuild-lyrics.test.ts`: regression assertions for contextual words, particles, long vowels, unknown characters, source/timing preservation, cache collisions, lyric version matching, ambiguity and provider failures.
- `scripts/rebuild-lyrics-audit.ts`: bounded live LRCLib corpus audit; complete lyrics processed only in memory; persisted report contains recording metadata, content hashes and quality counts.

## Verification and practical accuracy limits

Run `node --import tsx --test scripts/rebuild-lyrics.test.ts` and `node --import tsx scripts/rebuild-lyrics-audit.ts`. The latter writes `docs/rebuild/lyrics-corpus-report.json`, exits nonzero if fewer than thirty songs are audited or source fields change, and records provider failures rather than calling them passes.

The live LRCLib run on 2026-11-07 successfully audited **30/30 songs, 1,609 lyric lines and 10,678 tokens**. Original text/timing fields stayed intact on every song. Four unresolved tokens on four lines were flagged for review across Lemon, 白日 and 逆夢. The report does not store lyric text. The first live run also revealed a provider record pairing Japanese synced lyrics with an English plain field; the selector now keeps the Japanese representation and discards the translated field.

The thirty-song corpus check demonstrates real provider coverage, complete-text processing and timing preservation. It does **not** certify every line's intended pronunciation. A morphological dictionary improves standard words substantially, but Japanese lyrics deliberately use alternative readings: the LiSA title 炎 is “homura,” while an ordinary dictionary may choose “honoo.” The new reviewed-reading override mechanism is the required path for singer-intended readings. Prefer licensed furigana/reading data when available; otherwise retain a clearly identifiable dictionary-derived reading and route unusual words for native-speaker review. No automatic assertion can honestly guarantee perfect accuracy on all Japanese lyrics.

## Production integration

The new `useLyrics` client cache uses a separate bounded IndexedDB namespace plus complete recording input and engine versions. Readings are adopted only when original text, start/end times and word timings agree exactly. Kuromoji remains server only, and `next.config.ts` traces its dictionary files. Reviewed kana spans and borrowed word timings require exact text agreement.

The production `FullPlayer`, `QueueDialog`, `LyricsView`, `ShareDialog` and provider-independent `SharedSong` use Ink tokens, native modal focus containment and viewport-bounded scrolling. Queue states refer to a unique queue occurrence. Lyric sharing preserves adjacent visible lines across instrumental gaps and verifies them against the actual recording's provider lyrics. Track shares use server canonical metadata even when the client submits substituted metadata. Public share pages preserve the recording and selected start time through login links.

`scripts/rebuild-player-mobile-smoke.mjs` passed 16 production dialog checks at 320px/390px in light/dark mode, with 40 queue entries, exact move/remove, one current occurrence, bounded scrolling and focus containment. Authentication was live; catalog, media and lyric data were explicitly supplied browser fixtures. This is UI verification, not production streaming evidence.

`scripts/rebuild-sharing-api-smoke.ts` passed against the running app and fresh database: actual dictionary particles/counters; unchanged original line and word times; actual LRCLib Lemon match with 92 source lines; canonical share metadata; anonymous public page; no account details in its response; deleted shares unavailable; and rejected private-network artwork.

Share creation also uses the common `sameRequestOrigin` guard. The targeted `--origin-only` check accepts the authenticated public localhost origin even when Next's internal bind address differs, and rejects an unrelated site with 403. A later full provider rerun received LRCLib's explicit unavailable response (503); provider uptime is not a regression pass or an assurance of universal lyric availability.

`scripts/rebuild-export-smoke.mjs` passed actual browser PNG and WebM export. The PNG retains the exact selected Japanese and English text at 1080×1350. Maintained Mediabunny/WebCodecs encode deterministic 24fps frames and a selected slice of actual decoded recording audio. The WebM decoded as 1080×1080, 1.02 seconds, with audible Opus audio at the fixture's expected 880Hz after its selected .2s offset. Cancellation produces `AbortError`. The ready file is shared from a separate click gesture. Browsers without the needed codecs offer PNG and links.

Regression suites now total **55 passing tests** (48 lyrics plus seven player/share policy tests). Export and mobile reports/screenshots remain ignored under `.local`; copyrighted provider lyrics are processed in memory and are not committed.

The existing Korean liaison, Chinese per-character tones and unvowelled Arabic/Hebrew paths also lack universal accuracy. The new Japanese foundations do not claim to have rebuilt those languages. Add per-language linguistic engines and native-language fixtures when replacing their endpoints; do not relabel the existing approximate output as exact.
