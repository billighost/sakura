# PWA second review

The review of `01851d4` found reproducible edge cases beyond the first verification pass. Each repair has a regression or a browser reproduction; no further live lyric publication was performed.

## Repairs

- Automatic playback now parks unavailable streaming-only entries while offline, chooses playable saved successors, and skips failed automatic sources with a bounded retry chain. Manual selections retain their visible errors. Sleep expiry is checked against wall time before transitions, and pause fences delayed queue replies. Prepared audio uses the current sound mode and keeps its same-origin fallback.
- A cached document is replaced only after its required modules are saved. Storage failures and origin 5xx responses retain usable fallbacks. Navigation preserves gesture suppression, modal callbacks and startup clicks. Public pages, collection actions and Bloom Close work through their offline paths.
- Lyrics use an identity independent of reading engine versions. Migration keeps synced copies and matching multilingual guides; weekly checks preserve the selected reading language. Unrelated 404 responses remain retryable. Late storage reads and auto-sync cannot replace newer publications.
- Manual lyric timing survives reopening. Editing words invalidates obsolete timing without dropping unstamped imported lines. Preview holds the recording at its natural end. Publication locks edits until completion. Enabled buttons meet 4.5:1 text contrast in light and dark themes at 320px and 390px. Invalid enhanced word timestamps are rejected before proof of work; malformed successful replies keep a recoverable draft error.
- The modal closing blur had a CSS compilation issue: the duplicate prefixed declaration caused the closing override to disappear. The standard declaration survives compilation and clears blur in the first closing frame.
- Playback and preference journals preserve independent offline tab edits. Only matching, typed acknowledgments retire them. Preference operations retain per-field baselines and exact acknowledgments; immutable accepted snapshots prevent stale tabs from restoring old settings. History drainage gives healthy entries a chance even behind retained failures.
- Favorites retain per-song server revisions after unlikes. First delivery of an old offline choice cannot undo a newer remote choice. Exact state/revision snapshots, durable confirmations, canonical aliases and storage ordering preserve the same result across reopening and concurrent writers. Conflicts retain the newer remote choice and explain it to the user.

## Evidence

| Area | Evidence |
| --- | --- |
| Playback transitions | `.local/autoplay-browser-report.json`; provider regressions |
| Worker and routing | `.local/offline-app-interaction-smoke-report.json`; `.local/offline-routing-phase-smoke-report.json` |
| Production offline navigation and reconnection | `.local/pwa-offline-browser-report.json`; `.local/review-final-pwa-browser-rerun.log` |
| Cache migration and publication races | `.local/cache-review-verified-report.json` |
| Lyric timing and theme contrast | `.local/lyric-studio-second-review/report.json` |
| Compiled closing backdrop | `.local/modal-backdrop-review/report.json` |
| Sync counterexamples | `.local/offline-sync-audit-report.json`; retained journal/provider regression suites |
| Favorite migration rollout in PostgreSQL | `.local/favorite-rollout-postgres-report.json` |

The production offline suite now includes twelve journeys. Reusable checks include `test:modal:browser`, `test:lyrics:cache:review`, the expanded `test:lyrics:studio:browser`, and the journal tests in the main/sync/PWA scripts.

## Final verification

- `npm test`: **818 passed** across its five groups (39, 96, 317, 233 and 133).
- `npm run test:sync`: **142 passed** across its two groups (100 and 42).
- Production Next build: compilation, TypeScript and all **62 pages** passed. Standalone TypeScript passed; full ESLint reported **zero errors and 15 existing warnings**.
- Production PWA browser: **12 journeys passed**, zero page errors and zero blocked/upstream writes. Three positive matching listening receipts verified reconnection. The fixture returns the current settings revision contract and dismisses the expected cold-offline notice through its normal button before checking footer navigation.
- Lyrics studio review: **19 browser checks**, including two mocked publications and light/dark mobile contrast, with zero page errors. Cache review: **seven browser checks**. Playback: **11 real song endings**, including hidden and offline transitions. Compiled modal review: **six checks**, with zero page errors.
- Actual configured PostgreSQL: **six rollout checks** passed for current setters, legacy changes, delayed first deliveries, exact revisions and account cascade deletion. Every synthetic-account mutation was rolled back; no test data remained.

Private browser logs and reports stay in `.local/` and are excluded from Git. Temporary app fixture routes were removed; production code and reusable verification scripts are retained.

## Live lyrics

After the first GitHub push, the hosted worker and authenticated lyrics API both returned HTTP 200. Normal and explicit-refresh lookup return LRCLIB record **40279485** with synced lyrics for the correct Norhan recording and 157-second duration. All supplied words and stanza spacing match; the current upstream record omits the supplied final newline. Evidence: `.local/live-rollout-lyrics-second-review.json`.

## Release

The review adds `FavoriteChoice` and additive receipt metadata to `src/rebuild/data/schema.sql`. `npm run migrate` successfully applied the additive changes to the configured database and reported `legacyDataChanged: false`. Membership and receipt triggers preserve revisions while older deployed setters remain active. Apply the repository migration before releasing to another database.

Physical iPhone background playback remains untested; verified browser transitions and persistent journals do not prevent operating-system suspension or deliberate site-data deletion. Plain/missing lyric update checks never remove the saved offline copy because of its age.

The user authorized the complete GitHub push and workspace cleanup. Generated build deletion was rejected by automatic approval review as `blocked by policy`; ignored local builds and browser evidence remain on disk. Source, configuration and database/download records are preserved.
