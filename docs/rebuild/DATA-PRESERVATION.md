# Account preservation before the Sakura replacement

Listening hours are recoverable. The configured database contains actual audible time in `ListeningHistory.msPlayed` and retained time in `PlayAggregate.totalMsPlayed`. A catalog wipe without first preserving both would cascade-delete history and aggregates, because both reference `Track` with `onDelete: Cascade` (`prisma/schema.prisma:281`, `:498`).

## Backup completed and verified

On 2026-11-07, both accounts were exported from one repeatable-read, read-only PostgreSQL transaction to a private local artifact:

```text
.local/rebuild-backups/accounts-2026-11-07T03-50-34-481Z-42dc8baa.json
```

The artifact is intentionally excluded from version control. Do not publish it or paste its account data into logs. Source scripts and aggregate evidence are reviewable; the actual backup contains private account/profile and library information.

| Check | Result |
| --- | --- |
| Accounts | 2 |
| Track snapshots | 408 |
| Raw listening rows | 523 |
| Aggregate rows | 139 |
| Raw audible ms | 78,398,001 |
| Aggregated audible ms | 55,732,139 |
| Conserved total | 134,130,140 ms across both accounts |
| File size | 913,572 bytes |
| SHA-256 | `876a97d8c872c9a7ad818159bcaaa3abb1268741bfa8938ff83c9ac20856ca89` |
| Local rehearsal | Checksum, JSON contract, artist/album/track/playlist references and per-account audible sums all passed |

The scripts never modified the live database. The rehearsal did not connect to a database. No destructive cleanup has been run. The combined 37.258-hour figure must not be displayed as the owner's individual hours.

The backup includes profiles, settings, artists, albums, track metadata/IDs/provider references, track artists, favorites, playlists/folders/order, raw listening events and their audible milliseconds, aggregates, taste profiles/feedback/affinities and snoozes. Password hashes, OAuth connections/tokens, audio URLs, Telegram file access references, preview URLs and transient playback/session state are explicitly excluded.

Existing login accounts must remain in place through migration. This credential-free artifact alone cannot restore passwords or an OAuth connection after deleting `User`. Keep the `User` and auth infrastructure intact, or arrange a separate encrypted database backup and verified credential migration before deleting them.

Re-run the read-only preservation/rehearsal with:

```powershell
node scripts/rebuild-preserve-accounts.mjs
node scripts/rebuild-check-backup.mjs <path-to-private-backup.json>
```

The writer fsyncs a temporary file, verifies its checksum, then atomically renames it and writes a checksum manifest. It prints file details and aggregate totals only. New backup files use unique names and do not replace an earlier snapshot.

## Required cleanup and migration sequence

1. Build and rehearse the replacement in an isolated database/schema. Record the exact source snapshot and import checksum. Do not repoint scripts that write to the live `DATABASE_URL`.
2. Keep the existing users. For each account, calculate an immutable baseline: raw audible ms + aggregate audible ms, raw event count + aggregate play count, completions/skips, earliest/latest timestamps. Store retired recording display snapshots independently of provider cache.
3. Reconcile canonical recordings with provider aliases and explicit version identity. Same title/artist/duration is a candidate match, not proof. Keep originals, remixes, live/acoustic recordings and explicit/clean versions distinguishable. Preserve the source→canonical alias map used for every migration.
4. Migrate references in favorites, playlists, histories, aggregates, snoozes and other account tables in one consistent import. When two track IDs become one recording, sum their aggregate counters and audible time; do not discard real listening events just because their recording IDs converge. Deduplicate playlist membership only according to an explicit playlist-occurrence policy.
5. Verify per-account exact millisecond totals, counts and track/artist references. Import idempotency should key source event IDs/import batch IDs, so retrying an import cannot multiply hours.
6. Rehearse failure/rollback and compare sample rendered profiles to the source baseline. Add new listen events after the preserved baseline; never silently recompute historical hours from full track durations.
7. Cut over the selected UI and new backend, then retire the old catalog only after the replacement passes data and playback checks. Refresh the private backup immediately before cutover so listening since this audit is included.

## History retention needs a new transaction contract

The existing retention code's additive upsert and later independent delete can double count on failure or concurrency. Fix this in the new backend before scheduling retention:

- Begin a transaction and acquire a job lock.
- Capture one cutoff and select a bounded batch of raw event IDs under a row lock.
- Fold exactly that batch into aggregate rows using the same signal function.
- Delete exactly those selected event IDs inside the same transaction.
- Commit once; rollback preserves both the raw events and the previous aggregates on any failure.

To preserve accurate calendar-year/month/day/streak views after raw-event pruning, retain daily per-account listening summaries. A lifetime per-track aggregate lacks the dates needed to reconstruct those charts.

The current public `/api/export` is not a migration backup: it omits audible time and aggregates and truncates raw history. The private scripts deliberately avoid using it.
