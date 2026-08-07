# Sakura — Codebase Audit

Findings from a full read-through, verified against the live database where
possible. Severity is about user impact, not code tidiness.

**Legend:** ✅ fixed in this pass · ⚠️ open, worth doing next · 💭 design note

---

## Critical — things that were silently broken in production

### 1. ✅ No database defaults on `id` columns → every raw INSERT omitting `id` failed

Prisma's `@default(uuid())` is generated **client-side**. The generated
migration therefore created `"id" TEXT NOT NULL` with no default. That's fine
for code going through Prisma — but this app talks to Postgres directly with
`pg` for almost everything.

Every raw `INSERT` that omitted `id` failed with a not-null violation:

| Statement | Consequence |
|---|---|
| `INSERT INTO "UserMix" …` (`api/home/mixes`) | **"Made for you" was permanently empty** |
| `INSERT INTO "SystemPlaylist" …` (`lib/charts.ts`) | Top 50 charts never populated |
| `INSERT INTO "UserSettings" …` (`api/settings`) | Settings save failed for any user with no settings row |

All three were wrapped in `.catch(() => …)` or fired from a `setTimeout`, so
they failed **completely silently** — the page just rendered an empty section.

Fixed in `prisma/migrations/20260806230000_id_defaults/migration.sql` by
setting `DEFAULT gen_random_uuid()::text` on every text PK. This fixes all
current and future raw inserts at once and is transparent to Prisma.
Verified: a bare `INSERT INTO "UserMix"` with no `id` now succeeds.

### 2. ✅ Schema drift — `ListeningHistory.skipped` existed in Prisma but not in the database

`schema.prisma` declared `skipped Boolean @default(false)`; the initial
migration never created the column. Every query filtering on it errored:

- All five queries in the old mix generator used `WHERE h.skipped = false`
- Combined with #1, this meant mix generation could not succeed by any path

Added in the taste migration. I also wrote a drift checker during this pass
and confirmed the schema and database now match exactly.

### 3. ✅ `/api/stream/[trackId]` wrote a ListeningHistory row per request

```ts
execute(`INSERT INTO "ListeningHistory" ("userId","trackId") VALUES ($1,$2)`)
```

The audio element hits this endpoint on load, on seek, and on every range
request. One song could log a dozen "plays", and a song skipped after two
seconds logged exactly as strong a signal as one played end to end. Any
recommendation built on this data would be badly wrong.

Removed. Real play data now comes from `/api/signals`, which knows how long
audio was actually audible. See `src/lib/signals.ts`.

### 4. ✅ Proxy matcher redirected `/sw.js` to `/login`

```ts
matcher: ["/((?!api|_next/static|_next/image|icons|images|manifest.json|favicon.ico).*)"]
```

`sw.js` wasn't excluded, so a logged-out fetch of the service worker got a 307
to `/login`. Registration failed and **offline support never worked** — the
feature the last commit was entirely about. `robots.txt` and `favicon.svg` had
the same problem (the `.` in `manifest.json` was also unescaped, matching any
character).

Fixed with a `.*\..*` clause covering all root-level files with extensions.

---

## High — real bugs with user-visible consequences

### 5. ✅ Queue tracks with empty `audioUrl` stalled playback silently

`TrackRow.playTrack` builds the queue with `audioUrl: t.audioUrl || ""` — only
the tapped track gets resolved via `/api/music/download`. Skipping onto any
other un-downloaded track set `audio.src = ""`, which stalls with no error and
no advance. The player just stopped.

Fixed in `PlayerContext`'s load effect: an unresolved track is now resolved on
demand, the result written back into the queue, and an unresolvable one skips
with a toast instead of hanging.

### 6. ✅ Connection pool leaked on every hot reload

```ts
const pool = new Pool({...});          // constructed unconditionally
if (NODE_ENV !== "production") globalForPool.pgPool = pool;
export const sql = globalForPool.pgPool ?? pool;
```

The global was read *after* constructing, so the guard never prevented
anything — each reload built a fresh 20-connection pool. Also no `error`
listener, so an idle client error (server restart, network blip) would crash
the process as an unhandled event.

Fixed: read the global first, construct only on miss, attach an error handler.

### 7. ✅ Three divergent copies of the queue-advance logic

`next()`, the `ended` handler, and the `error` handler each had their own
~35-line copy of the same up-next / shuffle / repeat / end-of-queue logic. They
had already drifted — `next()` didn't resume playback after advancing, while
the other two did.

Collapsed into a single `advance({ autoplay })`. This is also where radio
refill hooks in — with three copies, that would have meant three integrations.

### 8. ✅ `addToDownloadQueue` mutated state and nested a setter inside an updater

```ts
setDownloadQueue((prev) => {
  prev[existingIdx].priority = Math.max(...);  // mutates current state
  setDownloadStates(updatedStates);            // nested setter
  ...
});
```

Updaters must be pure — React calls them more than once under StrictMode, so
the nested update fired twice, and the in-place mutation was invisible to
change detection. Rewritten as two independent functional updates.

### 9. ✅ Registration had a check-then-insert race

`findFirst` then `create` is not atomic; two simultaneous signups with the same
username both pass the check and one gets a 500. Now catches Prisma's `P2002`
unique violation and returns the same friendly 409.

### 10. ✅ "Top 50 in your Country" was the US chart for everyone

`fetchAppleMusicChart` mapped `nigeria`/`africa`/`global` but let `country`
fall through to the `'us'` default. Fixed to honour the passed country code.

### 11. ✅ Unguarded array access on third-party chart responses

`data.feed.results.map(...)` and `data.data.map(...)` throw if the provider
returns an error object. Since the caller catches and moves to the next
provider, a malformed response silently burned a provider slot. Added shape
checks.

### 12. ✅ Null-deref risk in chart ingestion

`artistRow.id` and `trackRow.id` were used without checking the insert
returned a row, and the artist insert had no `ON CONFLICT` despite
`Artist.name` being unique — two concurrent chart updates genuinely race there.
Both fixed.

### 13. ✅ Mix cache key wasn't scoped to the user

`cacheKey("mix", id)` — mix ids are user-owned so this wasn't exploitable
today, but it's one careless lookup away from serving one user's mix to
another. Now `cacheKey("mix", userId, id)`.

### 14. ✅ `json_build_object` produced fake albums

`json_build_object('title', al.title, ...)` on a `LEFT JOIN` yields
`{"title": null}` rather than `null` when there's no album, so the UI rendered
an empty album link. Wrapped in a `CASE WHEN al.id IS NULL`.

---

## Medium — all fixed in this pass

### 15. ✅ `/api/batch` hardened

**Correction to my original finding:** I described `new NextRequest(url, { headers })`
as depending on Next internals. It doesn't — that's a public documented API, and
I overstated the problem. The real defects were: a fabricated
`{ params: Promise.resolve({}) }` second argument, no cap on `requests.length`,
no de-duplication of keys (two entries with the same key raced to write the
same result slot), and no rejection of cross-origin paths.

All four fixed. I deliberately did *not* extract all seven route bodies into
shared library functions: that's 610 lines of churn to remove a fragility
rather than a live bug, and the regression risk outweighed the benefit.

### 16. ✅ Download-all loops replaced with the centralised queue

Six pages (album, artist, liked, mix, playlist, system playlist) each had their
own sequential `for` loop awaiting each blob inline — the tab was tied up for
minutes on a long playlist, nothing could be cancelled, and closing the page
lost everything not yet finished. One of them even dynamically `import()`ed
`offline-db` *inside* the loop body, once per track.

All six now call a shared `useDownloadAll` hook that hands work to
`PlayerContext`'s download queue, which already persists across reloads, pauses
on low battery in the background, prioritises whatever is about to play, and
reports per-track progress. The pre-flight "what's already downloaded" check
also went from serial to parallel.

### 17. ✅ Background work moved from `setTimeout` to `after()`

Chart refresh and mix generation were kicked off with `setTimeout(..., 100)`
during a server render. On a serverless host the function can be frozen the
moment the response flushes, so that work silently never ran. Both now use
`after()` from `next/server`, which is the supported way to defer past the
response and keeps the runtime alive for it. The chart freshness check is also
awaited rather than floated.

### 18. ✅ Rate limiting added

New `src/lib/rateLimit.ts` — Redis fixed-window, **fails open** so a cache
outage can't take down playback. Applied to the endpoints that actually cost
something:

| Endpoint | Limit | Why |
|---|---|---|
| `/api/music/download` | 20/min | drives the Telegram bot, 3 retries, 60s timeouts |
| `/api/radio` | 40/min | several scoring queries per call |
| `/api/signals` | 60/min | cheap, but a buggy client could loop |
| `/api/home/mixes` | 6/5min | regenerates every mix |
| `/api/taste` (recompute) | 10/min | full profile rebuild |

### 19. ✅ `TTL.HOME` raised 30s → 5min with explicit invalidation

Home aggregates eight queries plus precomputed mixes that only regenerate every
few days, so a 30s TTL meant nearly every visit paid full cost for unchanged
data. Raised to 5 minutes, and the mutations that should bust it now do:
like/unlike, batch like, playlist create, and mix regeneration all clear the
home key.

### 20. ✅ Colour extraction cache bounded

**Correction:** my original finding said this "runs on every track change with
no cache". That was wrong — `lib/color.ts` already cached per URL and
de-duplicated in-flight requests. The actual (much smaller) issue was that the
cache was unbounded. Now capped at 300 entries with insertion-order eviction.

### 21. ✅ Search-page N+1 collapsed to one query

`api/music/explore` ran a `SELECT` per track inside `Promise.all` — up to 25
round trips, each with two `ILIKE` scans. Now a single query using
`= ANY($1::text[])`.

Also tightened the fallback match from `ILIKE '%title%'` to exact
case-insensitive equality: the substring form matched in both directions
("Man" matched "Superman"), which showed unrelated tracks as already-downloaded.

### 22. ✅ `localStorage` writes debounced

`queue`, `upNextQueue` and `downloadQueue` each serialized and wrote on every
change — and a radio refill appends 15-20 tracks at once. Now debounced 500ms
via a `useDebouncedStorage` hook that flushes synchronously on
`visibilitychange` and `pagehide`, so the delay can never lose real state.

### 23. ✅ `auth()` wrapper removed

The wrapper existed for a dev-only "sign in as the first user" fallback — an
auth bypass, already removed. What was left was a pass-through typed
`(...args: any[])` with a `@ts-ignore`, which erased NextAuth's overloads.
Now `auth` is exported directly from the NextAuth instance, so call sites get
real types.

---

## Low — all fixed in this pass

24. ✅ `IMPROVEMENTS.md` now carries a status banner marking it historical and pointing at `ROADMAP.md` / `AUDIT.md`. Kept rather than deleted — the per-page accessibility detail is still a useful checklist.
25. ✅ `dev.log` and `test-mb.js` untracked from git, deleted, and added to `.gitignore`.
26. ✅ **Correction:** `tsconfig.tsbuildinfo` was never tracked — `*.tsbuildinfo` is already in `.gitignore`. Verified with `git ls-files`. No action needed.
27. ✅ **Correction:** `.env` was never committed either — `.env*` is already gitignored, and `git ls-files` confirms it's absent. My original finding was wrong. (Left untouched per your instruction regardless.)
28. ✅ Silent `catch` blocks in the server hot paths replaced with a `softFail(label, fallback)` helper that logs before falling back. Aggregate pages still degrade gracefully instead of 500ing, but a persistently failing query is now visible in logs rather than presenting as an empty section — which is exactly how findings #1 and #2 stayed hidden. 31 call sites labelled across `homeData`, `radio`, `mixes` and `taste`.
29. ✅ `PlayerProvider` context value memoised. It was rebuilt on every render, so every consumer re-rendered on every `progress` tick (several times a second) — including each row of a long track list.
30. ✅ Stray `-p` directory (a mistyped `mkdir -p`) removed.

---

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run build` — passes, all new routes registered
- Schema-drift checker written and run — no drift remaining
- Both migrations applied and re-applied (idempotence confirmed)
- Taste engine exercised end-to-end against the real database with 12 synthetic
  artists / 90 tracks / 140 graded plays:
  - `signalWeight`: completed `1.000`, instant-skip `-0.896`, half-listen `0.292`, replay `1.500`
  - An artist skipped 28 times scored **−16.23** and was correctly excluded from radio
  - `buildRadio` returned 12 tracks, max 2 per artist, each with a "why"
  - All five mix types generated once the catalogue was broad enough; Daily Mix
    artist sequence correctly round-robins rather than clustering
- All synthetic test data removed afterward; database left as found
