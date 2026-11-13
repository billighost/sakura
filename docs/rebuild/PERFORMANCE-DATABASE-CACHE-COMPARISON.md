# Database and public-cache performance verification — 2026-11-12

This records the database/cache implementation against the approved review. Counts below come from the actual services with deterministic injected SQL, Redis and provider transports. They are not production latency, PostgreSQL execution plans, or hosted throughput results. No configured remote database, migration, deployment or external configuration was used.

## Implemented and verified

| Item | Result | Evidence and limits |
| --- | --- | --- |
| O1 ordinary SQL and locks | Promise queries now record fixed `db_query` and `db_lock` stages. Transaction control/acquisition retain their existing stages. Numeric pool pressure is available through `rebuildPoolPressure`. | `scripts/rebuild-db.test.ts` runs real pg-pool lifecycle against deterministic socket clients, including failures, destruction, uncertain commits, callback overloads and account isolation. Timing carries no query text, parameters or connection configuration. |
| D4 exact ingestion | A three-credit, two-reference, one-album ingestion changes from 17 sequential statements / 12 write attempts to 10 statements / 7 write attempts. Identical repeat ingestion uses 2 reads / 0 writes. Both counts include the advisory-lock SELECT and exclude BEGIN/COMMIT. | `src/rebuild/server/server.test.ts` verifies changed artwork, exact aliases, alternate releases, ISRC conflicts, featured credits, multiple primary credits, current album IDs and repeat equality. The separate post-INSERT binding SELECT deliberately remains: it observes a concurrent ON CONFLICT winner that a same-statement CTE snapshot may not see. Real concurrent PostgreSQL conflict tests remain a release gate. |
| Ordered batch indexing | At most three recordings enter acquisition at once; results retain input order. Failure aborts pending siblings and owns already-entered SQL until all consumers settle. | Server tests exercise eight inputs, first-item conflict, pre-abort and a blocked entered consumer. Successful descriptive rows retain existing individual-request commit semantics. |
| C1 public Redis writes | Useful scoped responses no longer await SET. One request-lifetime callback drains at most two workers; keys coalesce and values are serialized before return. Per request: 32 entries / 2 MiB. Across active scopes: 128 entries / 8 MiB. | `scripts/rebuild-public-cache-writes.test.ts` verifies a blocked SET does not gate the operation, snapshots, coalescing, byte/count caps, private-data rejection, failures and closed originating shared flights. Standalone work remains awaited. The lifecycle adapter uses installed Next 16.4.5 `after`; writes are best effort, subject to the existing Redis four-command admission and timeout/circuit policy. |
| C2 exact/ISRC Redis | Versioned, validated public exact-record and successful ISRC projections cross service instances. Warm L1 bypasses Redis; successful L2 hits receive a short L1 lease. | `scripts/rebuild-exact-catalog-cache.test.ts` proves a second Deezer exact instance does not fetch upstream, a second Spotify exact instance does not authorize, and an ISRC hit avoids its lookup + exact fetch. It checks malformed IDs/credits/proof, missing-record retries, injected transport isolation and absence of tokens, previews and signed media. First L2 misses add a bounded Redis GET; regional net benefit still needs hosted measurement. |
| D5 pure read snapshots | Feed, hero, taste sync, mix detail, offline mix and read-only export can derive a missing initial-taste recipe without UPDATE. Durable repair remains in explicit settings/catalog maintenance. | `scripts/rebuild-account-projection-performance.test.ts` verifies identical recipe signatures and zero UPDATE for the snapshot helper, with one durable repair UPDATE for the legacy helper. Existing account history/erasure locks remain. |
| D3 combined feed + hero | `includeHero=1` on the first feed page reuses one taste context and one full card-hydration batch. Standalone hero refresh stays available; cursor pages omit hero. | Account-projection tests prove exact standalone/combined hero equality for Home and Discover, one candidate/evidence acquisition, one hydration query and unchanged cursor session. The server-only WeakMap snapshot enables after-response catalog cooldown checks without exposing account settings in the payload. Browser cache integration belongs to the root application change. |
| D8 bounded taste sync | Negotiated sync reads the top 500 summaries before aggregating their hour weights and omits feedback display-card hydration. Ordinary profile/export reads remain complete. | A 632-record fixture checks the exact 500th boundary, promotion of record 632 into the next snapshot, complete ordinary evidence, expired feedback and all 725 deletion receipts. The hourly SQL joins selected recording IDs. No deletion ledger, receipt, account lock or 15-second client freshness policy was reduced. Actual PostgreSQL scan cost is unmeasured. |
| D9 global optional-work admission | At most four catalog operations run, at most two background operations run, and at most 128 wait. Foreground work precedes queued background work. Source queries, provider work, ingestion and maintenance projections share admission without nesting. | `scripts/rebuild-catalog-admission.test.ts` exercises priority, capacity, queued abort, recovery, independent enrichment cancellation, active public-enrichment coalescing and ten account warmups with at most two preliminary background SQL projections. Warmup deadline includes waiting; after-feed cooldown can perform zero SQL when passed a compatible snapshot. Sustained hosted fairness/foreground contention still needs realistic measurement. |

The earlier injected seven-instance Deezer SET sensitivity sample measured a median 1.86 ms with instant SET and 88.68 ms with synthetic 60 ms SET. Those noisy local numbers establish the previous foreground dependency only; they are not a production improvement claim. The new controlled-gate test proves dependency removal without treating host scheduling noise as latency evidence.

## Conditional database work deliberately left unapplied

The workstation has no discoverable `psql`, `postgres`, `initdb` or Docker executable. The available configured remote database was not queried. Consequently there is no honest isolated `EXPLAIN (ANALYZE, BUFFERS)` baseline, representative database cardinality, lock-wait percentile, WAL comparison or migration rehearsal. The following changes remain measurement gates, rather than speculative schema or lock changes.

### D6 timestamp predicates and an additive index

`data/schema.sql` indexes `(account_id, COALESCE(occurred_at,created_at))`. `data/listeningEvidence.ts` and `recommendations/feed.ts` filter raw `occurred_at`; `data/listeningInsights.ts` filters the timezone-converted local calendar date. Account-prefix use remains possible, but ordered timestamp range use is not established by the current expression index.

In an explicitly authorized disposable PostgreSQL fixture, compare the current query with a candidate raw `(account_id,occurred_at)` index. Evaluate a non-null partial index and an optional covering variant independently; do not select either before measuring index size, write cost and all consumers. Keep the existing expression index because erasure/legacy-date paths use its semantics.

For the 30-day local chart, test an equivalent UTC lower bound derived from the first local calendar day before substituting it for `(occurred_at AT TIME ZONE zone)::date >= first_day`. Do not introduce an upper bound or treat missing dates as created dates: both would change current evidence semantics. Test DST transitions, midnight transitions, skipped calendar dates, fractional offsets, late uploads, null dates and future timestamps against the existing SQL oracle.

Required measurements: 10k / 100k / 1m chunks, both sparse and mature accounts, cold and warm buffers, actual and proposed plan rows/buffers/time, ingestion WAL/index growth and period-clear correctness. No schema file was changed by this agent.

### D7 repeated analytics and durable summaries

Profile hours currently expand each chunk's recording genres; all-time genres already use `ListeningRecordingSummary`. A candidate query can aggregate `(recording_id, local_hour)` first and then expand distinct published genres once per recording/hour. This could reduce genre expansion on a mature account, but requires the real planner and raw-oracle parity: untagged time, genre normalization, equal shares and floating-point addition order must remain correct.

An incremental hour/day summary is deeper work. It must handle out-of-order and idempotent receipts, partial-period erasure, unknown historical dates, timezone changes and later catalog-genre corrections. No new durable table or backfill is justified without proving query savings outweigh maintenance and correctness costs. Existing profile/export evidence remains complete.

### D5 lock/snapshot redesign and the remaining D3 mix context

The pure helper is implemented; changing exclusive history locks to shared reads or moving ranking outside a transaction is not. A snapshot/revision protocol must first prove that all privacy, feedback, preference, clear, Bloom and retry paths preserve erasure consistency, including concurrent GET/clear and sleeping device reconciliation. Measure lock hold/wait and five-slot pool pressure under two-account traffic before selecting the protocol. Pool size is unchanged.

Feed and mix candidate reservoirs intentionally differ: feed includes known/unexplored lanes and pinned initial choices; mix generation uses its own recent 2,500 reservoir and all-time situational evidence. Reusing a superficially similar feed context would change recommendations. Compatible mix evidence reuse remains conditional on an explicit shared snapshot API with independent reservoir/output parity. Durable mix generation and cursor ordering remain unchanged.

### D12 typed source-proof comparison

`data/catalog.ts` checks `source.id::text = delivery.sourceAssetId`. A guarded UUID comparison could use the primary-key lookup, but existing recording-scoped indexes may already make the source set small. Compare both plans at realistic assets per recording and proof distributions before changing it. Historical malformed JSON source IDs must produce a missing proof, never an unsafe cast exception or relaxed readiness/ownership/SHA/size validation. No proof predicate was changed. Product-route HEAD work is covered by the API agent's separate changes.

## Relevant verification commands

Run the four new suites plus `scripts/rebuild-db.test.ts`, the safe provider/Redis suites, personalization/feed/hero/top-song suites and `scripts/test-rebuild-server.cjs`. The full repository typecheck, lint, production build, realistic startup/feed browser scenarios and audio/offline/account gates belong to the root serial verification. Do not run credentialed `*:db` scripts against a configured remote database to fill the missing isolated measurement evidence.

## Continuation verification

The continuation reran the eight deterministic database, public-cache, exact-catalog,
account-projection, catalog-admission, product-DTO, provider-performance and Redis
suites: **61 tests passed, zero failures**. The isolated TypeScript/server runner
also passed **103 tests, zero failures**, including batch ingestion, exact recording
identity and cancellation. The API timing inventory check covers **53 routes and
71 explicit methods**, with no untimed export. Logs are
`.local/continuation-server-product-mocked-tests.log` and
`.local/continuation-server-core-tests.log`. These checks use injected transports;
they are not hosted query plans or latency measurements.

An earlier continuation batch mistakenly included `scripts/rebuild-product.test.ts`.
Despite its name, it loads configured database credentials and creates a disposable
schema plus synthetic accounts. That run was outside the approved read-only
database scope. Its cleanup hook completed the drop of its exclusive fixture schema
and the guarded deletion of its two synthetic accounts; the exact fixture journal
under `.local/product-db-fixture-*.json` records `status: "cleaned"`. No further
database queries were issued. That run is excluded from the approved validation
counts above and supplies no missing production or isolated-planner evidence.
The preceding statement that no remote database was queried describes the original
implementation pass, not this mistaken continuation run. Audit test imports and
pool injection before execution rather than relying on a `:db` filename convention.
