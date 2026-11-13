# Product API, imports and export performance

This implements D1, D2, D10, D11 and the registration/share-body part of W2 from
the approved 12 November review. Baseline application: `5229fdb`. No production
migration, external configuration or deployment was performed.

## Behavior and compatibility

Current application requests negotiate `X-Sakura-DTO: 3`. Header-absent installed
clients retain their complete legacy API envelopes. The resource boundary can
normalize old saved envelopes without cloning song cards. Current collection and
history responses omit duplicate arrays/cards and profile raw-scoring evidence;
the existing `/taste` synchronization path remains authoritative.

Current Library cursor pages contain membership/cursor data; only the initial
`kind=all` page includes playlists. Favorite synchronization still uses
`/library/state`, preserving unlike tombstones and revisions. Legacy Library
pages retain their paired choice snapshot. Card conversion is performed once in
both Library and History rather than once for each compatibility alias.

Current profile edits return the authoritative updated profile from SQL RETURNING.
Playlist creation, rename/reorder and membership mutations return compact
authoritative receipts. Legacy callers still receive full playlist detail.
Consumers may merge a matching known revision or perform one targeted refresh;
an unknown/conflicting membership must not be guessed. New membership validation
projects verified recording IDs instead of unused audio/card proofs. Artist and
album routes now pass consumer cancellation through the shared provider reads.

The `ImportReceipt` addition in `data/schema.sql` records a validated provider:id,
account and exact committed result. Receipt lookup precedes preview/indexing;
playlist creation and its receipt commit atomically under the request lock.
Receipts survive playlist deletion so a lost response cannot recreate removed
content. Reused request IDs for another source/account are rejected. A schema
capability check retains the old safe import behavior before the reviewed
additive migration is applied; legacy pre-receipt playlists also retain their
compatibility path. **Receipt replay optimization requires that migration.**
There is no request-path DDL. Confirmation now uses four cancellable workers,
preserves source order and continues a durable commit if the HTTP response is lost.

Current exports use one read-only REPEATABLE READ snapshot and 128-row SQL cursor
batches. No exclusive account-history lock is held. All rows, null dates, raw
measurement semantics and metadata sanitization remain present. Commit precedes
the JSON terminating byte. Disconnect, cancellation, query failure and a five
minute maximum close/roll back the snapshot and release the connection. Explicit
HEAD verifies identity without opening an export snapshot. The browser saves the
native response Blob rather than parsing and pretty-stringifying every row.

Registration and sharing enforce their existing limits while reading UTF-8 bytes,
with cancellation and a bounded stalled-body wait. The registration rate map
retains at most 2,000 active keys; saturation rejects new keys without evicting
existing rate limits. The shared product JSON reader keeps its default 98,304-byte
limit and exposes an explicit limit for the separately versioned session protocol.

## Evidence

The same mocked actual Library fixture used in the audit contains 50 songs,
1,000 favorite choices and 30 playlists:

| Measurement | Legacy branch | Implemented current branch |
| --- | ---: | ---: |
| JSON bytes | 189,242 | 36,467 |
| gzip bytes | 10,248 | 2,055 |
| Transaction statements | 6 | 4 |

Source cards were identical. These are synthetic payload/query measurements,
not deployed API latency or production percentiles. The audit's 10,249 gzip-byte
sample differs by one byte because fixture timestamps differ.

A safe pre-change export fixture with 100,000 measurements produced 23,590,035
compact JSON bytes and 31,790,295 pretty output bytes. One same-process sample
spent 82.74 ms serializing, 174.54 ms parsing and 150.70 ms pretty-stringifying;
host load was uncontrolled. The new browser path eliminates those parse/pretty
copies; it does not make the complete resulting file disappear from storage.

`scripts/rebuild-product-dto-performance.test.ts` verifies canonical/legacy cache
compatibility, UTF-8/oversize/stalled/aborted bodies, flood admission, Library query
and payload reduction, compact mutation ownership/revisions, exact import replay,
source mismatch, concurrent retry, pre-migration fallback, ordered worker
stragglers, 10,000-row complete export, cursor bounds and disconnect/timeout cleanup.
The 11 new checks plus the existing 18 provider/entity checks passed. Existing
favorite/receipt/performance checks passed 52 tests. Scoped lint passed without
errors or warnings; the initial full typecheck had only other agents' in-progress
errors and must be rerun as the final repository gate.

The production browser harness `scripts/rebuild-product-export-browser.mjs`
intercepts every API and validates 10,000-row native downloads, zero export JSON
parse/pretty operations, retry after failure and URL cleanup at 390px. Run against
an identified loopback production build with `SAKURA_TEST_URL`; set
`SAKURA_PRODUCT_BASELINE=1` for the prior build. Reports are saved under `.local/`.
Browser execution and final repository gates are recorded in the combined report.

## Limits requiring honest measurement

Mocked SQL tests verify requested isolation and cursor lifecycle, not a live
PostgreSQL concurrency plan. Real isolated PostgreSQL snapshot/erasure tests and
production-like browser runs remain required gates; no configured remote database
was written. Streaming bounds Node batches but holds one pool connection until
completion/cancellation. PostgreSQL sorts may still use work memory or disk, and
the complete native Blob occupies browser storage. These costs require mature
account, slow-reader, constrained-device and pool-contention measurements.

Header Server-Timing measures initial response preparation, not complete export
delivery. Optional fixed-route export telemetry separately reports generated
rows/bytes, elapsed stream time and completion without account IDs or payloads.
