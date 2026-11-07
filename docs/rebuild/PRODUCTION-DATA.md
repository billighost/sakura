# Fresh production data and API contract

The user selected Sakura Ink and explicitly replaced the preservation request with authorization to wipe all application data. The earlier private backup remains ignored and was **not imported** into the replacement.

## Executed reset

On 7 November 2026 the reviewed CLI installed the v2 schema, verified the configured target against a private inventory plan, acquired exclusive locks, and transactionally cleared **48 application tables**. The two old accounts, 408 old track rows, old collections and old listening data were removed. All application row counts reconciled to **zero** before commit. Migration bookkeeping and extension objects were excluded. Schema version 1 remains installed.

The target fingerprint was `76fd3650ef5ceb96f53fd9b1365e73baf1bccb058d62bcdc3a88c5c8b2874777`. Plans are private under `.local/rebuild-reset/`. The reset command refuses an expired plan, a different target, changed counts, an unknown public table, or an incomplete reconciliation. No route runs migrations or resets.

Existing JWTs cannot access v2 services after reset: the new authentication helper verifies that the account still exists. Registration creates a fresh identity; preference defaults and onboarding start independently of the old tables.

## Replacement schema

`src/rebuild/data/schema-auth.sql` bootstraps the minimal fresh identity table, including case-insensitive unique login indexes. `src/rebuild/server/schema-proposal.sql` defines canonical recordings, exact external references, verified audio assets, downloads and lifetime listening totals. `src/rebuild/data/schema.sql` defines owned favorites/playlists, settings, artist/album projections, listening receipt ledgers, mixes, shares and leased audio resolution jobs. The shared server pool is `src/rebuild/data/db.ts`. A new deployment does not need the old product tables.

Recording UUIDs identify songs. Provider references identify catalog appearances. Queue occurrences and device download artifacts have separate identities. Favorites and playlist membership use the canonical UUID, never a title hash. Artist and album rows use exact provider references and consistent artwork provenance. Artist/album detail endpoints accept a canonical UUID, `deezer:<id>` or `spotify:<id>` reference, so search navigation works before catalog ingestion. Valid artist portraits survive unavailable optional upstream track/discography endpoints; locally indexed canonical songs remain visible.

## Product endpoints

All endpoints require a fresh account, scope user-owned queries to that account, validate mutations, reject a conflicting request origin and return private responses.

| Route | Behavior |
| --- | --- |
| `GET /api/v2/home` | `{recent, liked, mixes, featured, playlists, needsOnboarding}`; verified catalog cards remain resolvable without downloaded audio. |
| `GET /api/v2/library?kind=liked\|all\|downloads` | `{recordings, tracks, playlists, nextCursor}`; bounded page size and stable keyset ordering. |
| `POST /api/v2/library` | `{recordingId, liked}` sets the favorite state idempotently. |
| `GET/POST /api/v2/playlists` | List owned collections or create `{name, description?}`. |
| `GET/PATCH/DELETE /api/v2/playlists/[id]` | Own collection detail, metadata changes or deletion; PATCH `recordingIds` reorders the exact existing membership. |
| `POST/DELETE /api/v2/playlists/[id]/tracks` | Add `{recordingIds}` or remove `{recordingId}` with owner checks, canonical uniqueness and locked ordinal ordering. |
| `GET/PATCH /api/v2/settings` | Flattened theme/audio/privacy/discovery/motion preferences and `seedArtists`, `seedGenres`, `onboarded`, `revision`; partial changes preserve other settings. |
| `GET/PATCH /api/v2/profile` | Account profile, actual audible time, play/completion/skip totals and top artists. |
| `GET/POST /api/v2/history` | Paginated display history or idempotent incremental audible chunks. |
| `GET/POST /api/v2/mixes` | Stable daily persisted mixes or refreshed candidate acquisition and selection. |
| `GET /api/v2/mixes/[id]` | Ordered canonical cards with `ready`/`insufficient-candidates` state and explicit playability. |
| `GET /api/v2/artists[/id]`, `albums[/id]` | Consistent metadata, provider detail navigation, actual track lists and discography. |

## Audible-time contract

Clients submit `{eventId, recordingId, sequence, msPlayed, positionMs, completed, skipped?, finished?, context, contextId?}`. `msPlayed` is **incremental audible playback since the previous submission**, bounded to 120 seconds per chunk. Retries reuse the identical sequence and payload. Paused/buffering time is excluded by the player.

The server locks the event and atomically inserts its receipt, adds time to the event and lifetime/recording summaries, and applies each terminal flag once. Conflicting retries return 409; concurrent repeats add time once. Delayed earlier increments remain valid. Private-session plays create no history. Display compaction deletes raw display references only; permanent receipts prevent an old replay from changing listening hours after compaction.

## Catalog and recommendation generation

Fresh seed tooling imports online catalog candidates through **exact provider lookups**, obtaining canonical references/ISRC evidence before creating rows. It creates no audio downloads and imports no legacy records. The initial successful run indexed 60 verified recordings across 48 primary catalog artists, with zero failures; subsequent user selections grow that catalog. Exact album detail enrichment supplied real provider genre tags to 47 of the initial recordings; missing genre evidence remains untagged. Federated Spotify search supplies original Burna Boy “Ye”, which was absent from the queried Deezer results.

Mix selection uses favorite/listening/onboarding affinity, discovery preference, unheard and familiar artist distinctions, explicit-content preferences, recent listening exclusions, blocked/snoozed targets, artist caps and a maximum 20% overlap with each prior mix. A conservative primary-credit bucket prevents multiple provider appearances from bypassing the artist cap without merging durable artist identities. Day seeds and persisted membership make navigation stable. An insufficient pool remains visibly insufficient instead of repeating songs to fill a shelf. The frontend must disable or omit Play for unavailable mixes.

## Verification

- `node --import tsx --test scripts/rebuild-product.test.ts`: **9/9 passed** against PostgreSQL. Covers settings, owner boundaries, favorite pagination, playlist identity/order, concurrent and delayed listening chunks, retention replay, private sessions, artwork consistency and distinct persisted mixes. Each run uses an isolated catalog schema; fixtures and schemas are explicitly removed.
- `npx tsx scripts/rebuild-product-api.test.ts`: **19 HTTP checks passed** using real registration and NextAuth login, anonymous/origin rejection, account-scoped library/playlist/mix/settings APIs, exact audible-time retries and Deezer artist/album navigation. Synthetic accounts are explicitly removed in `finally`.
- `npx tsx scripts/rebuild-product-api.test.ts --providers-only`: **8 targeted checks passed** with the real browser Origin header: localhost mutations accepted, foreign origin rejected, Deezer entities, original “Ye” Spotify search/index, Spotify artist portrait/tracks and album cover/tracklist. Valid core portraits survive restricted optional Spotify endpoints. The initial no-Origin HTTP suite missed the host binding mismatch; the shared public-host origin helper and this regression cover it.
- `node scripts/rebuild-migrate-check.mjs`: **fresh 26-table install passed**, including fresh identity defaults and no legacy product tables. All temporary DDL was rolled back.
- `node --test src/rebuild/recommendations/planner.test.mjs`: **8/8 passed** for pure genre/history/artist/overlap selection contracts.

The live database showed intermittent network read timeouts during the first integration attempt. The shared pool now destroys failed transaction sockets; the subsequent complete suite passed. No mutating request is silently retried: callers retain operation identities where idempotency is required.

## Operations

```text
node scripts/rebuild-migrate.mjs --apply
node scripts/rebuild-migrate-check.mjs
node scripts/rebuild-migrate-reset.mjs
node scripts/rebuild-migrate-reset.mjs --apply --plan <reviewed-private-plan>
npx tsx scripts/rebuild-migrate-seed.ts
```

Schema installation is additive. Reset is a separate explicit CLI operation intended only for an authorized target. Seed/import paths do not search for or silently import old application rows.
