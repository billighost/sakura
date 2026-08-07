# Sakura — Upgrade Roadmap

38 concrete upgrades, ordered by leverage. Each says what it is, why it's
worth doing, and roughly what it touches. Effort is **S** (hours), **M** (a
day or two), **L** (a week+).

The taste system that just shipped is the foundation for a lot of this — items
marked 🎯 get most of their value *because* per-play signals now exist.

---

## Tier 1 — highest leverage right now

### 1. Seed the catalogue 🎯 · **M**
Everything here is gated on catalogue size. The taste engine, radio and mixes
all work (verified end-to-end), but with an empty `Track` table there's nothing
to recommend. A backfill job that walks Deezer charts by genre and pre-resolves
the top few hundred tracks would turn every feature on at once. **This is the
single highest-value item on the list.**

### 2. "Song radio" and "Artist radio" entry points 🎯 · **S**
`startRadio(seedTrack)` already exists in `PlayerContext` and is wired to the
engine — it just has no UI. Add "Start radio" to the track context menu, the
artist page, and the full player's overflow. Nearly free, and it's the feature
people reach for most.

### 3. Explain every recommendation 🎯 · **S**
`buildRadio` already returns a `reason` per track ("Because you listen to X",
"Listeners like you play this"). Surface it in the queue sheet and under the
title in the full player. Recommendations that explain themselves feel
intelligent; unexplained ones feel random even when they're identical.

### 4. Thumbs down / "not for me" 🎯 · **S**
`TasteFeedback` and `recordFeedback()` are built and wired into scoring, with
no UI. A single long-press action on a queue row, mapping to `kind: "ban"`,
gives people a way to correct the radio — and gives the engine its strongest
negative signal.

### 5. A real job runner · **M**
Chart refresh, mix regeneration and taste recompute currently piggyback on user
requests via `after()`. That works, but it means the first visitor of the day
pays for the chart refresh, and a user who never opens the app never gets fresh
mixes. A cron endpoint (`/api/cron/*` + Vercel Cron or a GitHub Action) makes
this predictable.

### 6. Fix the catalogue's genre coverage 🎯 · **M**
Genre affinity is the signal that generalises to new music, but genres only get
populated when `enrichTrackMetadata` finds them. A backfill pass over existing
artists using Deezer + MusicBrainz tags would sharpen every Daily Mix. Worth
measuring first: `SELECT count(*) FROM "Artist" WHERE genres = '{}'`.

---

## Tier 2 — significant product wins

### 7. Crossfade and gapless · **M**
`crossfadeSeconds` and `gaplessPlayback` are in `UserSettings` and surfaced in
the UI, but nothing reads them — a single `HTMLAudioElement` can't crossfade.
Needs two elements and a Web Audio `GainNode` ramp. The settings currently
promise something that doesn't happen.

### 8. Normalize volume · **S–M**
Same situation: `normalizeVolume` is a no-op. Web Audio's `DynamicsCompressor`
plus a per-track gain from a ReplayGain-style analysis pass would make mixes
stop lurching between loud and quiet masters.

### 9. Listening stats / "Your year" 🎯 · **M**
`ListeningHistory` now records `msPlayed`, `completed`, `hourOfDay`,
`dayOfWeek` and `context`. That's everything needed for minutes listened, top
artists over time, a listening-clock heatmap, and discovery rate. High
shareability, and the data is already accruing.

### 10. Collaborative and public playlists · **L**
Playlists are single-owner with no sharing. Needs a `PlaylistCollaborator`
table, a `visibility` column, and share links. The most requested feature in
every music app.

### 11. Smart search that understands the catalogue · **M**
Search is a `title ILIKE '%q%'` scan. Postgres full-text (`tsvector` +
`pg_trgm` for fuzzy matching) would handle typos, match across title/artist/
album in one ranked query, and drop the N+1 that item #21 in the audit just
removed from explore.

### 12. Recently played, properly 🎯 · **S**
The home shelf shows distinct tracks. With `context`/`contextId` recorded, it
can show *what you were doing* — "Daily Mix 2", "Burna Boy radio", the album —
and resume it. This is Spotify's "Jump back in", and the data is there now.

### 13. Sleep timer: "end of track" · **S**
The timer cuts off mid-song. Adding "at the end of this track" and "at the end
of the queue" is a small change to `setSleepTimer` and the obvious thing people
actually want.

### 14. Queue persistence across devices · **M**
Queue lives in `localStorage`, so it doesn't follow you from phone to laptop.
A `PlaybackState` table (userId, trackId, positionMs, queue, updatedAt) with
last-writer-wins would make handoff work.

### 15. Lyrics quality and timing offset · **S**
`@stef-0012/synclyrics` output is used as-is. A per-track offset control
(±5s) and a manual re-sync would fix the common case where lyrics drift
against a Telegram-sourced file with different leading silence.

### 16. Album/artist pages: show what's actually there · **S**
Artist pages list tracks but not albums, singles, or "appears on". `TrackArtist`
already models featured credits — surfacing them is mostly query work.

---

## Tier 3 — polish that compounds

### 17. Optimistic navigation with real skeletons · **S**
Several pages fetch on mount and show nothing until resolved. `loading.tsx`
files exist for some routes but not all (`/mix`, `/onboarding`, `/settings`).

### 18. Virtualised long lists · **M**
A 500-track liked-songs page renders 500 `TrackRow`s. Now that the context is
memoised (audit #29) the re-render cost is fixed, but mount cost isn't.
`react-window` or CSS `content-visibility: auto` — the latter is nearly free.

### 19. Image optimisation · **S**
Every cover is a raw `<img>` pointing at Deezer's CDN. `next/image` with
`remotePatterns` would give responsive sizing, lazy loading and AVIF/WebP.
Meaningful on mobile data.

### 20. Keyboard shortcuts · **S**
Space to play/pause, `←`/`→` to seek, `J`/`K`/`L`, `/` to focus search, `Q` for
queue. Cheap, and makes the desktop experience feel finished.

### 21. Proper focus management and skip links · **S**
Modals (`QueueModal`, `LyricsModal`, `AddToPlaylistModal`) don't trap focus or
restore it on close. Keyboard and screen-reader users currently get lost.

### 22. Reduced-motion pass · **S**
Some components honour `prefers-reduced-motion`, most don't. The full player's
transitions are the worst offenders.

### 23. Error boundaries · **S**
No `error.tsx` anywhere. One thrown render error blanks the whole app.

### 24. Empty states with a way forward · **S**
Several are bare text. Each should offer the action that fixes it — the
onboarding flow does this well and is a good template.

### 25. Offline: make the state visible · **S**
`OfflineBanner` exists, but downloaded-only browsing isn't obvious. Grey out
what can't play, and add an "Offline mode" filter.

### 26. Storage management UI · **S**
`getStorageEstimate()` exists in `offline-db` and is unused. Show usage, and
let people clear by album or by "not played in 90 days".

---

## Tier 4 — infrastructure and correctness

### 27. Tests · **L**
There are none. The taste engine is the place to start — `signalWeight`,
`normaliseGenre`, `decayFactor` and `diversifyByArtist` are pure functions with
obvious edge cases, and they're now load-bearing for the whole product.

### 28. Structured logging · **S**
`console.log`/`error` throughout. The `softFail` helper added in this pass is a
step toward consistency; a real logger with levels and request ids would let
you actually diagnose production issues.

### 29. Health check and metrics · **S**
No `/api/health`. Add one that checks Postgres, Redis and Telegram, plus
counters for radio hit rate and mix generation success.

### 30. Telegram client resilience · **M**
`getTelegramClient()` is a singleton with a mutex and a 3-attempt retry. A
circuit breaker plus a persisted job queue would stop a bot outage from
manifesting as a wall of user-facing download failures.

### 31. Database connection limits for serverless · **S**
`max: 20` per instance is fine for one server and will exhaust Postgres under
serverless fan-out. Either drop to ~5 or move to a pooler (PgBouncer /
Supabase / Neon pooling).

### 32. `Track.audioUrl = 'pending'` needs a real state · **S**
`charts.ts` writes the literal string `"pending"`, and five separate queries now
filter it out with `<> 'pending'`. A nullable `audioUrl` plus a
`resolutionState` enum would express this honestly and stop the magic string
spreading further.

### 33. Deduplicate the catalogue · **M**
`sourceHash` and `telegramFileId` are unique, but the same song imported from
Deezer and Telegram creates two rows with different ids. `isrc` is captured but
unused — it's the right dedup key, and duplicates currently split a user's
affinity for the same track in two.

### 34. Soft-delete for playlists · **S**
`DELETE /api/playlists/[id]` is immediate and unrecoverable. A `deletedAt`
column plus a 30-day window and an undo toast.

---

## Tier 5 — taste system, next iteration 🎯

### 35. Session-aware radio · **M**
The radio scores against a long-run profile. Someone playing three jazz tracks
at midnight wants more of *that*, not their all-time favourites. Weight the
current session's tracks heavily for the next few picks — `buildRadio` already
takes a `seedTrackId`, so this is an extension of existing shape.

### 36. Audio features for real mood matching · **L**
Scoring is genre/artist/era based. Actual tempo, key, energy and valence would
enable "more like this but calmer" and genuinely coherent workout/focus mixes.
Deezer no longer exposes these; options are AcousticBrainz or computing them
locally with the Web Audio API on first play.

### 37. Better collaborative filtering · **M**
The current "users who played what I played" query is a reasonable
approximation but is O(users × plays) and unindexed for this shape. A nightly
item-item co-occurrence matrix in a small table would be faster and better —
worth doing once there are enough users for it to mean anything.

### 38. Let people see and edit their taste profile 🎯 · **S**
`GET /api/taste` already returns top genres, top artists, era centre, skip rate
and discovery. A profile page showing "here's what we think you like", with the
discovery slider and a way to remove a wrong artist, is both a trust feature and
a direct source of high-quality explicit signal.

---

## Suggested order

1. **#1 catalogue seeding** — unblocks everything
2. **#2, #3, #4** — a day's work total, all riding on engine code that already exists
3. **#5 job runner** — makes mixes and charts reliable rather than incidental
4. **#6 genre backfill** — sharpens every recommendation
5. **#27 tests** — before the taste engine grows further
6. Then Tier 2 by whatever you care about most
