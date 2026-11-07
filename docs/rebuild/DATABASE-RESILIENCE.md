# Database connection recovery

The installed `pg-pool` emits `Connection terminated due to connection timeout`
when opening a new connection exceeds the configured eight-second deadline. It
destroys and removes that socket before rejecting the query. It also removes
idle connections on socket errors and removes checked-out clients when
`pool.query` fails. Replacing the entire pool is unnecessary for these failures
and could interfere with unrelated transactions.

A separate read-only process on 7 November 2026 completed five concurrent cold
`SELECT 1` calls in 1.53–1.57 seconds and ten warm reads in 0.14–0.28 seconds.
The pool finished with five idle clients and no waiters. This confirms normal
connectivity at that measurement; it does not rule out the intermittent
production handshake failures observed during acceptance.

The new fixed account lookup also passed a live read-only check using a
nonexistent UUID: two simultaneous callers both received null in 2.0 seconds,
and a subsequent fresh check completed in 0.16 seconds. No personal account
record was read or modified for that probe.

`readAccountById` repeats only its fixed, parameterized account SELECT. A transport
failure, temporary connection failure or client read timeout permits one retry
after 150 milliseconds. Each attempt retains the eight-second pool acquisition
deadline and uses a six-second client read timeout. SQL validation errors,
server statement cancellation and missing accounts are not retried. Exhausted
connection failures propagate as service failures rather than missing accounts.

Concurrent lookups of the same account share only an active promise, held beside
the shared pool across server route modules. The promise is removed on success
or failure. No account snapshot survives into a later lookup, so deletion and
account changes still require a fresh existence check. Different account IDs
never share a read.

Mutations and transactions do not use the retry path. A transaction that loses
its connection discards the client without attempting another COMMIT or replaying
the operation. It does not enqueue rollback on an already unusable socket.

`scripts/rebuild-db.test.ts` uses the real PostgreSQL pool with deterministic
simulated sockets. Seven cases verify handshake destruction, read-timeout client
removal, immediate SQL-error and cancellation failure, the retry bound, active
account isolation, fresh missing-account checks, and single mutation execution
after an uncertain COMMIT. These tests use no database connection or credentials.
