# Sakura Bloom: saved experiences and listening insights

New snapshots are version 4. Each saves an experience derived from the account, recap ID, saved time zone, and assigned world. Its opening, closing, finale, chapter titles, duration comparison, composition, palette, and pacing remain fixed. Another period in the same world receives a different seed. Existing snapshots retain their original data and presentation rules.

The ten worlds now have seeded camera arrangements and four illustrated layouts for time and listening-pattern chapters. Chapter artwork uses that chapter's original disclosure frontier on replay, preventing newly revealed data from repainting earlier scenes. Covers remain small cached WebPs with deterministic edition marks; posters retain individual CSS transforms when serialized.

Weekly stories add a listening signature and favorite-song share. Monthly stories can additionally show average active-day listening, discovery/replay shares, top-five share, artist breadth, leading genre, strongest time band, peak day, streak, and playback sources. Yearly stories add active/peak months, opening/closing recorded months, the leading calendar quarter, weekend balance, and a comparison of the year's halves. Chapters are conditional on measured data; complete daily coverage is required for whole-period calendar milestones.

## Collection and migration

Audible duration, dated chunks, recording identities, and replay evidence already existed. Playback origin was stored only in history display rows and could disappear during compaction. Nullable `context` and `context_id` now live on `ListeningEventLedger`, with an additive backfill from known surviving display rows. New chunks retain their original origin; retries cannot change it. Missing historical sources remain unknown.

The change is included in `src/rebuild/data/schema.sql` and the existing schema installer. Apply `npm run migrate` to the deployment database during release. Until migration, feature detection preserves normal listening ingestion and recap queries can fall back to surviving display rows. New source retention honors existing listening consent, private-session, account ownership, export, and history-erasure rules. Monthly/yearly source chapters describe where playback began; they do not infer why a person chose a song.

## Promotion

The Home banner sits above the personalized feed and shares the shelf's cached API request. Unfinished available yearly campaigns take priority, followed by monthly and weekly. Completed, empty, expired, and stale-ready items cannot receive an actionable release campaign.

- Weekly: the preceding local calendar day, opening day, and following day.
- Monthly: three days of anticipation, launch and the next three days, days 7/14, and the final three days before closing.
- Yearly: fourteen days of anticipation, launch and the next fourteen days, later milestones at days 30/60/90/120/180/240/270/300/330, and the final week before closing.

Dismissal is scoped to the account, recap, and current calendar milestone. Later milestones can return. Local calendar boundaries account for DST and wake suspended tabs; app and OS reduced-motion preferences are honored.

## Regression coverage

Use `npm run test:bloom:listening` for experience, analytics, disclosure, calendar, persistence, refresh, audio, collection-origin compatibility, and promotion tests. `npm run test:bloom:covers` checks generated source hashes, bitmap integrity, dimensions, and budgets.

`SAKURA_LISTENING_ORIGIN_TEST_DATABASE_URL` enables the isolated PostgreSQL origin migration/compaction/erasure tests. Existing `scripts/rebuild-bloom-listening-db.test.ts` covers real SQL snapshot generation, source retention after compaction, timezone persistence, and history erasure races. Run database fixtures against an isolated test database.

Browser scripts cover all-world cinematic journeys, reading mode and PNG export, serialized poster geometry, and Home promotion phases/dismissal across mobile/desktop light/dark layouts. They intercept product APIs with synthetic accounts. Screenshots and reports are stored in `.local`.

Research and verified official Spotify, Apple, and YouTube references are recorded in [bloom-research.md](bloom-research.md). Future artist-by-month races can be derived from existing dated chunks; global fan percentiles or geography require additional evidence and are not invented here.

Handoff: implementation and migrations are in the working tree; release should apply the additive schema migration. No real notifications were sent, and no production deployment was performed.

Validated: 101 targeted pure Bloom/origin tests, 13 real PostgreSQL Bloom tests, 5 PostgreSQL origin/compatibility tests, 2 cover-integrity tests, 40 illustrated layout cases, 15 Home promotion checks, and cinematic journeys for all ten worlds on desktop/mobile. Poster checks include long multilingual text, legacy snapshots, sparse listening, and serialized image geometry. Scoped ESLint, TypeScript, and the full production build pass. On this Windows checkout, canonical `Desktop` casing is required to avoid loading duplicate React runtimes; `scripts/run-next.cjs` canonicalizes the path for normal dev/build/start commands.
