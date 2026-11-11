# Offline listening and library synchronization

## Research and decisions

The installed Next.js guides (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`, `01-app/03-api-reference/03-file-conventions/route.md`, and `01-app/03-api-reference/04-functions/fetch.md`) distinguish browser storage from the server fetch cache. Mutating account APIs need explicit durable client journals and server receipts; a framework cache does not provide delivery or deduplication.

[MDN's IndexedDB guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB#warning_about_browser_shutdown) warns that transactions started during unload can abort before completion. Sakura therefore saves small changes to a synchronous localStorage mirror and an IndexedDB journal before sending them, and records listening checkpoints during normal playback. Saving only when the app closes would leave an avoidable loss window.

[Background Synchronization](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) has limited browser availability. It cannot be the only recovery mechanism, particularly for an iPhone PWA. Sakura retries through account startup, foreground/focus, visible reconnection and normal foreground synchronization. Each category runs independently so one unavailable endpoint cannot prevent another category from syncing.

[The online event](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event) reports a network interface becoming available, rather than proving that Sakura's server is reachable. Failed requests therefore retain their pending changes. A successful status alone also does not constitute an application receipt.

[StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) can request persistent storage, but the browser may decline. Device storage protection reduces eviction risk; it cannot prevent deliberate site-data deletion or every operating-system cleanup. Storage errors must remain visible instead of being presented as successful local saves.

## Repairs

- Listening chunks retain their immutable event ID, recording ID, sequence, timestamp, audible duration and terminal outcome. Delivery snapshots the caller's accumulator before asynchronous work.
- Only an explicit accepted receipt, with matching identity whenever supplied, removes a pending chunk. Empty JSON, HTML, unrelated receipts, session failures and HTTP 400/404/409/410 retain the original evidence. Rejected chunks keep diagnostic status while healthy later chunks can still be delivered.
- Existing server listening transactions commit the chunk receipt and accumulated statistics together. Retrying the same sequence cannot count it twice. Clearing history continues to erase matching queued evidence and prevents delayed writes from recreating it.
- A current privacy or learning pause makes previously captured listening retryable. An explicit deletion receipt or a historical privacy-window rejection intentionally discards its evidence. Private listening is excluded at collection time as before.
- Favorite drafts now use per-operation journals in addition to whole-state snapshots. Independent offline tabs cannot replace another tab's pending song just by writing their own draft. Deliberate choices merge per song, and acknowledgment tombstones prevent a stale draft from restoring an already acknowledged operation.
- Favorite changes carry an operation ID to a new server receipt ledger. If a like committed but its response disappeared, retrying that operation after a newer unlike returns the current server choice without reapplying the old like. Operation IDs cannot be reused for another recording or the opposite choice.
- Preference edits continue to use server revisions and per-field bases. Independent edits can rebase, while a field changed on another device wins over a stale edit against an obsolete base. Unacknowledged newer local fields survive older in-flight acknowledgments.
- Queue and playback drafts require a synchronous mirror or a completed IndexedDB write before upload. If both paths fail, the provider shows a storage notice; one healthy path remains sufficient. Existing writer IDs, revisions and calibrated intent ordering protect against stale device checkpoints and clock jumps.
- Playback progress and deliberate playback choices now have separate server timestamps. A laptop's routine position checkpoint cannot reclaim ownership after the phone chooses a song. `choiceAt` persists inside a reserved JSONB field, which the API strips from public queue state and filters from incoming state. Passive saves advance `updatedAt` while retaining `choiceAt`; deliberate saves use bounded, calibrated intent times. Existing rows and old callers remain compatible, and this metadata needs no extra schema migration.

## Migration and scope

`src/rebuild/data/schema.sql` adds `sakura_v2."FavoriteOperationReceipt"`. Apply the repository's schema migration before deploying clients that send favorite operation IDs. The change is additive and preserves legacy favorite requests that omit the optional ID. This work does not apply a migration to the configured external database.

Listening and favorite data are account scoped. Receipt handling does not borrow another account's pending changes. Browser journals survive failed network requests and ordinary reopening, within the browser storage limitations above.

## Evidence

- `scripts/rebuild-favorites-journal.test.ts`: independent tabs, opposite choices, acknowledgment races, canonical recording migration, timestamp ties and total storage failure.
- `scripts/rebuild-favorite-receipts.test.ts`: concurrent retries, lost response followed by another device's unlike, operation reuse rejection, legacy compatibility and account isolation. These execute the real server operation against a deterministic transaction adapter; they do not mutate a hosted database.
- `scripts/rebuild-listening-outbox.test.ts`: accepted/unmatched/paused/deleted receipts, HTTP rejections, healthy backlog progress, caller mutation, exact retries and storage failure.
- `scripts/rebuild-listening-sync.test.mjs`: queue restoration, writer conflicts, offline reconnect, clock calibration, acknowledgments during newer edits and redundant-storage failures.
- `scripts/rebuild-session-choice.test.ts`: executes the real server transaction through a deterministic adapter to check passive versus deliberate timestamps, hidden JSONB metadata, filtered injection, lost-response idempotency, old-client compatibility and concurrent account isolation.
- `scripts/rebuild-playback-integration.test.ts`: executes the real provider with deterministic media and storage adapters, including durable favorite staging, duplicate presses, mismatched receipts, prepared-download removal and automatic queue continuation.
- `scripts/rebuild-account-sync-browser.mjs`: two synthetic browser devices and accounts verify exact download bytes, local download isolation, staged cancellation, offline like/unlike persistence, immutable listening replay and explicit deletion. Its playback race holds the phone's real deliberate PUT until the laptop commits a later routine checkpoint, then verifies that the phone retains its selected song.
