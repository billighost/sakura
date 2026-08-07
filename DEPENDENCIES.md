# External dependencies: resilience, fallbacks, and provider options

Written 2026-08-07. Covers every third-party service the app talks to, what
each failure looks like, and what was done about it.

---

## 1. What we actually hit

| Service | Used for | Auth | Cost | Where |
|---|---|---|---|---|
| **Deezer API** | Track/artist/album metadata, search, covers, genre + related-artist graph, charts | None | Free, no key | `lib/metadata.ts`, `lib/catalog.ts`, `lib/charts.ts`, several routes |
| **MusicBrainz** | Credits (producer/writer/engineer), ISRC, genre tags, samples | None (UA required) | Free | `lib/metadata.ts` |
| **iTunes Search** | *New* — fallback identification + search when Deezer fails | None | Free, no key | `lib/metadata.ts` |
| **LRCLib** | Synced + plain lyrics | None | Free | `api/lyrics` |
| **Lyrica** (HF Space) | Synced lyrics with romanisation | None | Free, community-hosted | `api/lyrics` |
| **Musixmatch / NetEase** via `@stef-0012/synclyrics` | Lyrics last resort | Scraped token | Free | `api/lyrics` |
| **Upstash Redis** | Cache, rate limiting | Token | Free tier | `lib/redis.ts` |
| **Postgres** | All persistent state | Conn string | ~500 MB budget | `lib/sql.ts` |
| **Cloudinary** | Avatar uploads | Key/secret | Free tier | `lib/cloudinary.ts` |
| **Telegram (GramJS)** | Audio source | Session string | — | `lib/telegram.ts` |

Everything except Postgres, Redis, Cloudinary and Telegram is keyless and free,
which is the property worth protecting: no credential can silently expire.

---

## 2. Failure modes actually visible in the code

These are inferred from the code's own defensive handling and comments — they
are the failures the codebase was already written around:

1. **Provider timeouts stalling the request path.** `lib/metadata.ts` carried a
   6 s timeout with the comment that enrichment "sits directly in the download
   path, so an unresponsive provider is a stalled download." Real, and it was
   only handled by giving up.
2. **MusicBrainz slowness / rate limiting.** MB enforces ~1 req/s. The old code
   made up to `2 + N` serial MB calls per enrichment (search → detail → one per
   work relation), which is the shape that gets a client throttled.
3. **`Promise.all` of bare fetches.** `api/artists/[id]` fired three unguarded
   Deezer fetches in one `Promise.all` — **one network blip rejected all three
   and 500'd the artist page**, even when the local DB had enough to render it.
   Same pattern in `api/albums/[id]`.
4. **Silent nulls.** `fetchJson` swallowed every error and returned `null`, so a
   provider being down was indistinguishable from a track genuinely having no
   credits. Nothing was logged. This is the "failures are silent" problem.
5. **Cache expiry turning an outage into an empty page.** Plain TTL: the moment
   an entry expired, a provider outage produced an empty section rather than
   slightly-old data.
6. **Lyrics: four providers, serial, no retry.** Each wrapped in its own
   `try/catch` that only `console.warn`ed. A slow provider added its full
   timeout to every request that fell through to it.

---

## 3. What was added

### Retry with backoff (`lib/resilience.ts`)
Full-jitter exponential backoff — `random(0, base·2ⁿ)`. Equal-jitter and fixed
backoff leave clients synchronised, so when a provider recovers every waiting
request hits it simultaneously and knocks it over again.

Retries are **selective**: 5xx, 429, 408, and transport errors only. A 404 or
400 is not retried — the identical request would fail identically and only
spends rate-limit budget.

### Circuit breaker (`lib/resilience.ts`)
Per-provider, in-process, `closed → open → half-open`. Opens after 5 consecutive
failures, 30 s cooldown, needs 2 successful probes to close. A failed probe goes
straight back to open rather than re-burning the whole threshold.

In-memory rather than in Redis on purpose: the question is "is *this instance*
wasting wall-clock on a dead host", and paying a Redis round trip to answer it
would defeat the point.

**The win:** with MusicBrainz down, enrichment previously cost 6–8 s of timeout
per call. Now the first few pay it, then every subsequent call returns instantly
for 30 s.

### Stale-while-error cache (`lib/cache.ts`)
`cachedWithStale` stores `{ value, staleAt }` and keeps the Redis row alive
**12× longer** than its freshness window. Four distinct states:

| State | Behaviour |
|---|---|
| fresh | return, no upstream call |
| stale + upstream ok | refresh, return new |
| stale + upstream down | **return stale, log it** |
| absent + upstream down | null, caller degrades |

This is the single biggest availability win here, because nearly everything we
read from outside is catalogue data that ages in *days*.

### Structured logging
One greppable line per external call: `[ext:deezer] search.track timeout 5003ms
attempt=2`. Successes are only logged when slow (>1.5 s) or retried — logging
every cache-warm hit buries the failures. Breaker transitions log explicitly.

`/api/health` now reports Postgres, Redis, **and every breaker's state**. Only a
dead Postgres returns 503: a tripped provider breaker must not pull the instance
out of rotation, since every other instance would be in the same state and the
app still serves.

---

## 4. Metadata provider alternatives — evaluated, not silently picked

You asked for trade-offs rather than a silent choice. All of these are free.

### Deezer — **kept as primary**
- **Cost:** free, no key, no registration.
- **Latency:** ~150–400 ms. Fastest of the group.
- **Richness:** track/album/artist, covers to 1000px, contributor credits,
  ISRC, genre ids, **related-artist graph**, **charts**, **per-genre artist
  lists**.
- **Against:** undocumented and unversioned — it can change without notice.
  Rate limit is ~50 req/5 s per IP and unpublished. No producer/writer credits.
- **Why primary:** the related-artist and genre-artist endpoints are what make
  the new mix architecture possible at all. Nothing else free offers that graph.

### iTunes Search — **adopted as fallback**
- **Cost:** free, no key.
- **Latency:** ~200–500 ms.
- **Richness:** track/album/artist, **artwork at any resolution** (higher than
  Deezer's), release date, primary genre, copyright.
- **Against:** no credits, no ISRC, no related-artists, no genre browsing. 20
  req/min soft limit. Album-track listings need a second `lookup` call.
- **Why fallback and not primary:** it can identify a track and dress it up, but
  it cannot seed a recommendation pool. Good insurance, poor foundation.

### MusicBrainz — **kept, narrow role**
- **Cost:** free, open data.
- **Latency:** ~800–2500 ms. Slowest by a wide margin.
- **Richness:** by far the best **credits** — producer, writer, lyricist,
  engineer, instrument-level performers, sample relationships. Nothing else free
  comes close.
- **Against:** ~1 req/s enforced; a UA is mandatory; deep credit data needs
  2–3 chained calls. Coverage is thin for non-Western and recent pop.
- **Verdict:** keep it *only* for credits, cached 30 days, never on a hot path.
  Its data is historical fact — it never needs refreshing.

### Last.fm — **rejected**
- Requires an API key (a credential that can expire — exactly what we're
  avoiding). Genuinely good similar-artist and tag data, arguably better than
  Deezer's for long-tail artists. But it has **no cover art** since 2019 and no
  audio metadata, so it would be an *addition*, not a replacement. Not worth a
  key for overlap with what Deezer already gives us free.

### ListenBrainz — **rejected for now**
- Free, keyless, open. Has genuine collaborative-filtering recommendations,
  which is better than anything derived here. But coverage is small, it's
  MBID-keyed (so every lookup needs a MusicBrainz resolution first, inheriting
  MB's latency), and it's slow. **Worth revisiting** if the taste engine ever
  needs real CF rather than the co-listen approximation in `lib/radio.ts`.

### Spotify Web API — **rejected**
- Best data in the industry: audio features (tempo, energy, valence,
  danceability) would make mood search genuinely accurate rather than
  genre-approximated. But it requires OAuth client credentials, tokens expire
  hourly, and the free tier now heavily restricts the recommendations and
  audio-features endpoints. Fails the "runs completely free with no
  credentials" requirement.

**Net:** Deezer primary → iTunes fallback → MusicBrainz for credits only. Zero
keys, zero cost, one graph-capable provider with a real fallback beneath it.

---

## 5. The mix/radio storage rework

**Problem you raised:** reliable mixes across genres need a broad track pool,
but storing that pool is unaffordable at 500 MB.

**What was wrong:** every mix builder queried the local `Track` table. Since
`Track` only holds songs someone already fetched, the reachable pool was tiny
and genre-narrow — so mixes repeated, and the only fix available was inserting
more rows. At ~1 KB row + indexes, covering a dozen genres properly is hundreds
of MB of songs nobody has played.

**What it does now** (`lib/catalog.ts`, `lib/virtualTracks.ts`):

Postgres keeps only what is genuinely ours and cannot be re-derived — users,
listening history, favourites, `GenreAffinity` / `ArtistAffinity` (the actual
taste model), and `Track` rows for songs really played.

Everything else is a question Deezer already answers free:

```
GenreAffinity + ArtistAffinity   (ours, tiny, in Postgres)
              ↓
     buildCandidatePool()
              ↓
  genre → artists  +  artist → related  (Deezer, cached 12–24 h)
              ↓
       artist → top tracks              (Deezer, cached 12 h)
              ↓
   VirtualTrack[]  — id: "deezer-<n>"
```

A `VirtualTrack` is a **candidate**, not a row. It becomes a real `Track` only
if someone actually plays it. `UserMix.trackIds` is already `String[]`, so
virtual ids needed **no migration**.

Display metadata (title/artist/cover/duration) goes to **Redis**, not Postgres —
it's derived, disposable, and expires with the mix that produced it. Losing it
costs one regeneration.

**Storage delta:** ~0 bytes of Postgres growth per mix regeneration, versus
hundreds of MB to achieve the same breadth by insertion.

**Cost:** one wave of concurrent, cached provider calls per regeneration.
Multi-call, as you predicted — but bounded (≤24 artists per pool) and almost
always served from cache. The fan-out is `Promise.all`, so wall-clock is one
round trip, not a serial walk.

The radio (`lib/radio.ts`) tops up from the same pool, but **only when the local
pool is thin** (`< max(60, limit·4)`), so a well-stocked library pays nothing.

---

## 6. Queue / radio desync — root cause

You reported "a different song plays than the details shown." It's a real bug
with a specific cause, in `components/PlayerContext.tsx`.

Four call sites derived `currentIndex` **inside a `setQueueState` updater**:

```js
setQueueState((prev) => {
  const idx = prev.findIndex(...)
  setCurrentIndex(idx)     // ← impure: a setState inside an updater
  return newQueue
})
```

React state updaters must be pure and **may be invoked more than once** —
StrictMode does so deliberately in dev. When that happens the committed queue
array and the committed index come from *different passes*, so
`queue[currentIndex]` resolves to a different track than the one the UI derived
its details from. That is exactly the reported symptom.

Fixed in `play`, `advance`, `removeTrack`, `removeTracks` — all four now compute
the next queue **and** the next index up front from `queueRef.current`, then
issue plain `setState` calls.

**Second, related bug:** resolving a pending track overwrote `track.id` in place.
Since `id` is the key the load effect is subscribed to, rewriting it re-fired the
effect, missed the "already loaded" guard, and restarted playback — and if the
resolved id already existed elsewhere in the queue, two entries shared an id and
every `findIndex` became ambiguous. Now the canonical id lands in a separate
`resolvedId` field, and `canonicalId()` is used wherever the server-facing id is
needed (signals, favourites, playback sync).

---

## 7. Not covered

The Telegram audio-acquisition path (`lib/telegram.ts`, `api/music/download`,
`api/stream/telegram`) is deliberately untouched — including the download
failure and the ~30-second truncation.

I did check one hypothesis and it is **wrong**, so it should not be pursued:
`metadata.track.previewUrl` (Deezer's 30-second preview clip) is written to
every track row at `api/music/download/route.ts:172`, but a search of the
codebase shows it is **never read as a playback or download fallback**. The
truncation is not the preview clip being served by mistake.
