# Account performance continuation — 12 November 2026

The continuation verified A1–A5 against the current account helpers. The user’s
15-second passive target, existing Saved behavior and offline fallback timing
remain binding. Requests, IndexedDB and storage failure cases below use isolated
fixtures; no configured database, account or provider was accessed.

## Completed behavior

Passive settings, favorites, taste and listening-session reads share account-scoped
flights and short observations across tabs through Web Locks and BroadcastChannel.
Periodic eligibility uses request start time, so delayed initial responses do not
postpone the next refresh. Early or duplicate timer callbacks preserve the same
15-second boundary; clock rollback resets it safely. The application integration
uses ordinary focus refreshes rather than advancing a periodic boundary on every
focus event. Mutations invalidate observations and account disposal cancels owned
transport.

Two cancellation races were fixed in `accountReadCoordinator.ts`: a caller aborted
synchronously during loader entry now receives rejection immediately, while peer
work continues; disposal during lock acquisition no longer starts obsolete network
work. Regression tests exercise both cases and periodic delayed-start/rollback
behavior.

Favorite confirmations persist changed pairs rather than every song. Preference
acknowledgments compact to field watermarks; favorite acknowledgments compact to
song watermarks. Stable operation orders remain in a small point-read ledger so
sleeping writers cannot receive a fresh order for a retired operation. Listening
choices use a durable monotonic floor before deleting older choices and receipts.
Both storage paths retain recovery independently; tests cover failed requests,
stale writers, aliases, rollback, conflict receipts and account isolation.

The version-two listening protocol preserves full occurrence/card metadata for
deliberate choices and sends small position checkpoints only for acknowledged
queues. UTF-8/body limits and the keepalive budget are checked explicitly. An
oversized keepalive choice remains durable for foreground retry. Playback
checkpoints retain deliberate ownership time rather than renewing it.

## Verification

The combined command passed **125 tests** across
`rebuild-account-coordinator.test.ts`, `rebuild-favorites-journal.test.ts`,
`rebuild-session-choice.test.ts`, `rebuild-preference-journal.test.ts`,
`rebuild-preference-receipt.test.ts`, `rebuild-listening-sync.test.mjs` and
`rebuild-session-journal.test.mjs`. After additional timer assertions, the final
coordinator suite passed **15 tests**. Tests with 100,000 reserved favorite or
preference orders visit at most four journal entries during hydration; the order
ledger is not scanned. Legacy 1,000-entry acknowledgment histories compact without
reviving old choices. Scoped ESLint passed for the coordinator and its regression
suite with zero warnings or errors.

`node scripts/rebuild-account-persistence-browser.mjs` exercised the current helper
source in Chromium with real IndexedDB, localStorage, Web Locks and
BroadcastChannel and intercepted every HTTP request:

| Scenario | IndexedDB puts | localStorage writes |
| --- | ---: | ---: |
| Unchanged 1,000-song snapshot | 0 | 0 |
| One unlike in 1,000 songs | 3 | 2 |
| Unchanged 5,000-song snapshot | 0 | 0 |
| One unlike in 5,000 songs | 3 | 2 |

The earlier audit observed 1,002 puts for an unchanged 1,000-song confirmation.
The current harness confirms removal of those writes. Three tabs made one request
in the first freshness period, one more in the second, and recovered with one
request after the first tab closed. There were zero page errors. Evidence is in
`.local/audit-account-persistence-browser.json`.

These are operation counts and isolated behavior checks, not production latency or
React startup/render benchmarks. Reserved order records intentionally remain
durable for old-writer safety; this bounds hydration scans rather than erasing all
historical bytes. Cross-tab lock/channel loss falls back to independent safe reads,
so request deduplication is best effort where browser coordination is unavailable.
Full application integration, production build/browser comparison and physical
browser qualification belong to the combined continuation verification.
