import { query, softFail } from "@/lib/sql";
import { cacheKey, cached, TTL } from "@/lib/cache";
import { getTasteProfile, normaliseGenre, type TasteProfile } from "@/lib/taste";
import { buildCandidatePool, resolveArtistDeezerIds, type VirtualTrack } from "@/lib/catalog";
import { setVirtualTrackMeta } from "@/lib/virtualTracks";

/**
 * The radio engine — what plays when the queue runs out.
 *
 * Scoring is a weighted blend rather than a single sort key, because "what
 * should play next" is genuinely multi-objective: it has to feel familiar
 * enough to be pleasant, novel enough to be interesting, and varied enough
 * not to become the same six artists on a loop.
 *
 * The pipeline:
 *   1. Gather candidates from several independent sources (loved artists,
 *      genre neighbours, collaborative signal, the long tail).
 *   2. Score each on familiarity / novelty / freshness / era / context fit.
 *   3. Apply hard exclusions (banned, snoozed, just-played).
 *   4. Diversify so no artist dominates, then interleave.
 *
 * Every stage degrades gracefully: with an empty profile it falls back to
 * popular-and-varied, which is a perfectly reasonable radio for a new user.
 */

export type RadioTrack = {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  albumId: string | null;
  coverUrl: string | null;
  audioUrl: string;
  duration: number;
  /** Why this was picked — surfaced in the UI as "Because you like X". */
  reason: string;
  score: number;
};

type Candidate = {
  id: string;
  title: string;
  artistId: string | null;
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  coverUrl: string | null;
  audioUrl: string;
  duration: number;
  genres: string[] | null;
  trackGenre: string | null;
  releaseYear: number | null;
  globalPlays: number;
  userPlays: number;
  lastPlayedAt: Date | null;
  liked: boolean;
  source: string;
};

/**
 * How many candidates to assemble per user, independent of the requested
 * limit. Scoring and diversification discard most of the pool, so this needs
 * headroom; keeping it fixed is what lets the pool be cached under one key.
 */
const RADIO_POOL_SIZE = 220;

const SCORING = {
  artistAffinity: 3.2,
  genreAffinity: 2.4,
  collaborative: 1.8,
  popularity: 0.8,
  novelty: 1.6,
  eraFit: 0.7,
  liked: 1.2,
  /** Penalty per recent play — stops the radio replaying today's rotation. */
  recencyPenalty: -2.5,
  /** Penalty for an artist already used in this radio batch. */
  repeatArtistPenalty: -1.4,
} as const;

/** Max tracks by one artist in a single radio batch. */
const MAX_PER_ARTIST = 2;

/**
 * Build a radio continuation for a user.
 *
 * @param seedTrackId  the track playing when the queue ran out, if any — its
 *                     artist and genre get a strong boost so the transition
 *                     feels connected rather than arbitrary.
 */
export async function buildRadio(
  userId: string,
  opts: { limit?: number; seedTrackId?: string | null; excludeTrackIds?: string[] } = {}
): Promise<RadioTrack[]> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const excludeSet = new Set(opts.excludeTrackIds ?? []);

  const [{ profile, affinities, genreAffinities, excluded }, seed] = await Promise.all([
    getRadioContext(userId),
    opts.seedTrackId ? fetchSeed(opts.seedTrackId) : Promise.resolve(null),
  ]);

  for (const id of excluded.trackIds) excludeSet.add(id);

  const artistScoreMap = new Map(affinities.map((a) => [a.artistId, a.score]));
  const genreScoreMap = new Map(genreAffinities.map((g) => [g.genre, g.score]));

  // Seed the maps from the currently-playing track so continuation feels
  // connected even for a user with no history at all.
  if (seed) {
    if (seed.artistId) {
      artistScoreMap.set(seed.artistId, (artistScoreMap.get(seed.artistId) ?? 0) + 6);
    }
    for (const raw of seed.genres ?? []) {
      const g = normaliseGenre(raw);
      if (g) genreScoreMap.set(g, (genreScoreMap.get(g) ?? 0) + 4);
    }
  }

  const positiveArtistIds = affinities.filter((a) => a.score > 0).map((a) => a.artistId);
  if (seed?.artistId && !positiveArtistIds.includes(seed.artistId)) {
    positiveArtistIds.push(seed.artistId);
  }
  const topGenres = Array.from(genreScoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([g]) => g);

  const bannedArtistIds = affinities.filter((a) => a.score < -3).map((a) => a.artistId);

  /**
   * 1. Gather the candidate pool — cached per user.
   *
   * This is the expensive half of a radio build: several wide Postgres scans
   * plus, on a thin library, a fan-out of provider lookups. It was rerunning on
   * every single request, which is what made radio the most expensive endpoint
   * in the app by a wide margin.
   *
   * It's cacheable because the pool depends only on the taste inputs computed
   * above (artists, genres, bans, size) — all of which change on the timescale
   * of listening habits, not requests. Everything that makes one radio differ
   * from the next — the seed, scoring, played-track exclusion, artist
   * diversification — happens in memory *after* this point, over the pool. So a
   * cached pool still yields a different station per seed and per play; it just
   * stops rediscovering the same few hundred candidate songs every time.
   *
   * `cached` single-flights it too, so the burst of radio requests that follows
   * a queue running out rebuilds the pool once rather than once per listener.
   */
  /**
   * The pool is built at one fixed size regardless of the requested limit.
   *
   * Sizing it from `limit` would key the cache by limit too, so a 20-track
   * continuation and a 50-track one would each build and store their own pool
   * of largely the same songs — and every invalidation site would have to know
   * every limit ever used in order to clear them. Building the largest useful
   * pool once and letting scoring take what it needs is both cheaper and
   * leaves exactly one key per user to invalidate.
   */
  const virtualLimit = Math.max(120, limit * 6);
  const discoveryLevel = clamp(profile?.discovery ?? 0.35, 0, 1);

  const candidates = await cached(
    cacheKey("radio-pool", userId),
    TTL.RADIO_POOL,
    async () => {
      // Each source runs independently and failures are isolated — a broken
      // source degrades the mix, it doesn't empty it.
      const dbCandidates = await gatherCandidates(userId, {
        artistIds: positiveArtistIds,
        genres: topGenres,
        bannedArtistIds,
        // Pull well beyond any `limit` — scoring and diversification both
        // discard a lot, and a thin candidate pool produces a repetitive radio.
        poolSize: RADIO_POOL_SIZE,
      });

      // Top up from the provider catalogue.
      //
      // The DB only holds tracks someone has actually fetched, so on a small or
      // genre-narrow library the local pool collapses to the same few dozen
      // songs and the radio loops. Virtual candidates make the reachable
      // catalogue as wide as the provider's without storing anything. They're
      // only fetched when the local pool is genuinely thin, so a well-stocked
      // library pays nothing.
      const wantVirtual = dbCandidates.length < Math.max(60, limit * 4);      const virtualCandidates = wantVirtual
        ? await gatherVirtualCandidates(userId, {
            genres: topGenres,
            positiveArtistIds,
            discovery: discoveryLevel,
            limit: virtualLimit,
          })
        : [];

      return [...dbCandidates, ...virtualCandidates];
    },
  );

  // 2. Score.
  const discovery = clamp(profile?.discovery ?? 0.35, 0, 1);
  const eraCenter = profile?.eraCenter ?? null;
  const eraSpread = profile?.eraSpread ?? 15;
  const now = Date.now();

  const seen = new Set<string>();
  const scored: { c: Candidate; score: number; reason: string }[] = [];

  for (const c of candidates) {
    if (excludeSet.has(c.id) || seen.has(c.id)) continue;
    // Virtual candidates legitimately have no audioUrl yet — they resolve on
    // play. Only a *local* row with a missing or stuck url is unplayable.
    if (c.source !== "virtual" && (!c.audioUrl || c.audioUrl === "pending")) continue;
    seen.add(c.id);

    let score = 0;
    let reason = "Picked for you";

    const artistScore = c.artistId ? artistScoreMap.get(c.artistId) ?? 0 : 0;
    if (artistScore !== 0) {
      // Compress with a log so one obsessively-played artist can't swamp
      // everything else — affinity should rank, not dictate.
      score += SCORING.artistAffinity * Math.sign(artistScore) * Math.log1p(Math.abs(artistScore)) / 3;
      if (artistScore > 0) reason = `Because you listen to ${c.artistName}`;
    }

    const genreList = c.genres?.length ? c.genres : c.trackGenre ? [c.trackGenre] : [];
    let bestGenre: string | null = null;
    let bestGenreScore = 0;
    for (const raw of genreList) {
      const g = normaliseGenre(raw);
      if (!g) continue;
      const gs = genreScoreMap.get(g) ?? 0;
      if (gs > bestGenreScore) {
        bestGenreScore = gs;
        bestGenre = g;
      }
    }
    if (bestGenreScore > 0) {
      score += SCORING.genreAffinity * Math.log1p(bestGenreScore) / 3;
      if (artistScore <= 0 && bestGenre) reason = `More ${bestGenre}`;
    }

    if (c.source === "collab") {
      score += SCORING.collaborative;
      if (artistScore <= 0) reason = "Listeners like you play this";
    }

    // Popularity, normalised — a gentle nudge toward things that work, not a
    // ranking by it.
    score += SCORING.popularity * Math.log1p(c.globalPlays) / 5;

    if (c.liked) score += SCORING.liked;

    // Novelty vs familiarity, dialled by the discovery setting.
    if (c.userPlays === 0) {
      score += SCORING.novelty * discovery;
      if (c.source === "deepcut" && artistScore <= 0) reason = "Something new";
    } else {
      // Known and loved is worth something to a low-discovery listener.
      score += SCORING.novelty * (1 - discovery) * 0.5;
    }

    // Recency penalty — heavy for something played in the last few hours,
    // fading out over about a week.
    if (c.lastPlayedAt) {
      const hoursAgo = (now - new Date(c.lastPlayedAt).getTime()) / 3_600_000;
      if (hoursAgo < 168) {
        const strength = 1 - hoursAgo / 168;
        score += SCORING.recencyPenalty * strength * strength;
      }
    }

    // Era fit — mild, and only when we actually know the user's centre.
    if (eraCenter && c.releaseYear) {
      const z = Math.abs(c.releaseYear - eraCenter) / Math.max(5, eraSpread);
      score += SCORING.eraFit * Math.exp(-z * z / 2);
    }

    // Small deterministic-ish jitter so identical scores don't always resolve
    // the same way and the radio varies between refreshes.
    score += Math.random() * 0.35;

    scored.push({ c, score, reason });
  }

  scored.sort((a, b) => b.score - a.score);

  // 3. Diversify. Greedy pass with a per-artist cap, applying an escalating
  //    penalty rather than a hard cut so a strong candidate can still win a
  //    third slot if the pool is thin.
  const picked: { c: Candidate; score: number; reason: string }[] = [];
  const artistCount = new Map<string, number>();
  const overflow: typeof scored = [];

  for (const item of scored) {
    if (picked.length >= limit) break;
    const key = item.c.artistId ?? item.c.artistName;
    const count = artistCount.get(key) ?? 0;
    if (count >= MAX_PER_ARTIST) {
      overflow.push(item);
      continue;
    }
    artistCount.set(key, count + 1);
    picked.push(item);
  }

  // Backfill from overflow if diversification left us short.
  for (const item of overflow) {
    if (picked.length >= limit) break;
    picked.push(item);
  }

  return picked.map((p) => ({
    id: p.c.id,
    title: p.c.title,
    artist: p.c.artistName,
    artistId: p.c.artistId,
    album: p.c.albumTitle,
    albumId: p.c.albumId,
    coverUrl: p.c.coverUrl,
    audioUrl: p.c.audioUrl,
    duration: p.c.duration,
    reason: p.reason,
    score: Math.round(p.score * 1000) / 1000,
  }));
}

// ── Candidate gathering ─────────────────────────────────────────────────────

/**
 * Provider-backed candidates, shaped to look exactly like DB rows so the
 * scorer needs no special cases.
 *
 * Two things are deliberately different from a real row:
 *   - `audioUrl` is empty. That's the player's existing "resolve before play"
 *     state, already handled by the load effect, so a virtual track flows
 *     through the queue untouched.
 *   - `artistId` is null, so artist-affinity scoring can't apply. Instead the
 *     provider's own popularity rank feeds `globalPlays`, which is a
 *     reasonable stand-in for "this is a well-known track" and keeps virtual
 *     candidates competitive with local ones without letting them dominate.
 */
async function gatherVirtualCandidates(
  userId: string,
  opts: { genres: string[]; positiveArtistIds: string[]; discovery: number; limit: number }
): Promise<Candidate[]> {
  if (opts.genres.length === 0 && opts.positiveArtistIds.length === 0) return [];

  try {
    const likedArtists = opts.positiveArtistIds.length
      ? await query<{ id: string; name: string; deezerId: string | null }>(
          `SELECT id, name, "deezerId" FROM "Artist" WHERE id = ANY($1::text[]) LIMIT 10`,
          [opts.positiveArtistIds.slice(0, 10)]
        ).catch(softFail("radio:virtual:artists", []))
      : [];

    const seedArtistIds = await resolveArtistDeezerIds(likedArtists);

    const pool = await buildCandidatePool({
      genres: opts.genres,
      seedArtistIds,
      discovery: opts.discovery,
      limit: opts.limit,
    });

    if (pool.length === 0) return [];

    // Cache display metadata so the client can render these before they're
    // resolved, and so a later mix or queue restore can find them.
    await setVirtualTrackMeta(
      userId,
      pool.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artistName,
        artistDeezerId: t.artistDeezerId,
        album: t.albumTitle,
        coverUrl: t.coverUrl,
        duration: t.duration,
      }))
    );

    return pool.map((t) => toCandidate(t, opts.genres));
  } catch (err) {
    console.error(
      "[radio:virtual] pool build failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function toCandidate(t: VirtualTrack, genres: string[]): Candidate {
  return {
    id: t.id,
    title: t.title,
    artistId: null,
    artistName: t.artistName,
    albumId: null,
    albumTitle: t.albumTitle,
    coverUrl: t.coverUrl,
    audioUrl: "", // resolve-on-play
    duration: t.duration,
    // The pool was built *from* these genres, so attributing them back is
    // accurate enough for scoring and is what makes "More afrobeats" show up
    // as a reason on a virtual pick.
    genres: genres.slice(0, 3),
    trackGenre: null,
    releaseYear: null,
    // Deezer's rank is roughly 0–1,000,000. Scaling it into the same order of
    // magnitude as a local play count keeps the popularity term meaningful
    // without letting a chart-topper outrank someone's actual favourites.
    globalPlays: t.rank ? Math.round(t.rank / 20000) : 0,
    userPlays: 0,
    lastPlayedAt: null,
    liked: false,
    source: "virtual",
  };
}

async function gatherCandidates(
  userId: string,
  opts: { artistIds: string[]; genres: string[]; bannedArtistIds: string[]; poolSize: number }
): Promise<Candidate[]> {
  const { artistIds, genres, bannedArtistIds, poolSize } = opts;
  const per = Math.ceil(poolSize / 4);

  const base = `
    SELECT t.id, t.title, t."artistId", COALESCE(ar.name, 'Unknown Artist') AS "artistName",
           t."albumId", al.title AS "albumTitle",
           COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl",
           t."audioUrl", t.duration, ar.genres, t.genre AS "trackGenre",
           al."releaseYear",
           COALESCE(gp.plays, 0)::int AS "globalPlays",
           COALESCE(up.plays, 0)::int AS "userPlays",
           up."lastPlayedAt",
           (fav."trackId" IS NOT NULL) AS liked
    FROM "Track" t
    LEFT JOIN "Artist" ar ON ar.id = t."artistId"
    LEFT JOIN "Album"  al ON al.id = t."albumId"
    LEFT JOIN (
      SELECT "trackId", COUNT(*)::int AS plays
      FROM "ListeningHistory"
      WHERE "playedAt" > NOW() - INTERVAL '90 days'
      GROUP BY "trackId"
    ) gp ON gp."trackId" = t.id
    LEFT JOIN (
      SELECT "trackId", COUNT(*)::int AS plays, MAX("playedAt") AS "lastPlayedAt"
      FROM "ListeningHistory"
      WHERE "userId" = $1
      GROUP BY "trackId"
    ) up ON up."trackId" = t.id
    LEFT JOIN "Favorite" fav ON fav."trackId" = t.id AND fav."userId" = $1
  `;

  const notBanned = `AND ($2::text[] = '{}' OR t."artistId" != ALL($2::text[]))`;
  const playable = `AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'`;

  const sources = await Promise.all([
    // A. Artists they already love — the reliable core of any radio.
    artistIds.length > 0
      ? query<Candidate>(
          `${base} WHERE t."artistId" = ANY($3::text[]) ${notBanned} ${playable}
           ORDER BY RANDOM() LIMIT ${per}`,
          [userId, bannedArtistIds, artistIds.slice(0, 40)]
        ).then((r) => tag(r, "artist")).catch(softFail("radio:candidates:artist", []))
      : Promise.resolve([]),

    // B. Genre neighbours by *other* artists — how taste generalises.
    genres.length > 0
      ? query<Candidate>(
          `${base}
           WHERE (
             EXISTS (
               SELECT 1 FROM unnest(COALESCE(ar.genres, ARRAY[]::text[])) g
               WHERE lower(g) = ANY($3::text[])
             )
             OR lower(t.genre) = ANY($3::text[])
           )
           AND ($4::text[] = '{}' OR t."artistId" != ALL($4::text[]))
           ${notBanned} ${playable}
           ORDER BY RANDOM() LIMIT ${per}`,
          [userId, bannedArtistIds, genres, artistIds.slice(0, 40)]
        ).then((r) => tag(r, "genre")).catch(softFail("radio:candidates:genre", []))
      : Promise.resolve([]),

    // C. Collaborative signal — what people with overlapping taste play.
    //     Cheap approximation: users who played any of *my* top tracks, then
    //     what else they played. Good enough at this scale and needs no
    //     precomputed similarity matrix.
    query<Candidate>(
      `${base}
       WHERE t.id IN (
         SELECT h2."trackId"
         FROM "ListeningHistory" h1
         JOIN "ListeningHistory" h2 ON h2."userId" = h1."userId"
         WHERE h1."userId" <> $1
           AND h1."trackId" IN (
             SELECT "trackId" FROM "ListeningHistory"
             WHERE "userId" = $1 AND completed = true
             GROUP BY "trackId" ORDER BY COUNT(*) DESC LIMIT 40
           )
           AND h2."userId" <> $1
           AND h2.completed = true
           AND h2."playedAt" > NOW() - INTERVAL '120 days'
         GROUP BY h2."trackId"
         ORDER BY COUNT(DISTINCT h2."userId") DESC
         LIMIT 120
       )
       ${notBanned} ${playable}
       ORDER BY RANDOM() LIMIT ${per}`,
      [userId, bannedArtistIds]
    ).then((r) => tag(r, "collab")).catch(softFail("radio:candidates:collab", [])),

    // D. The long tail — unheard tracks, weighted toward things with some
    //    traction. Also the total fallback for a brand-new user.
    query<Candidate>(
      `${base}
       WHERE up."trackId" IS NULL ${notBanned} ${playable}
       ORDER BY COALESCE(gp.plays, 0) DESC, RANDOM()
       LIMIT ${per}`,
      [userId, bannedArtistIds]
    ).then((r) => tag(r, "deepcut")).catch(softFail("radio:candidates:deepcut", [])),
  ]);

  // Flatten, keeping the first (highest-intent) source that produced each track.
  const merged = new Map<string, Candidate>();
  for (const list of sources) {
    for (const c of list) {
      if (!merged.has(c.id)) merged.set(c.id, c);
    }
  }
  return Array.from(merged.values());
}

function tag(rows: Candidate[], source: string): Candidate[] {
  for (const r of rows) r.source = source;
  return rows;
}

/**
 * Everything the scorer needs about a user, in one cached read.
 *
 * These five queries — profile, artist affinity, genre affinity, and the three
 * exclusion lists — were re-run on every radio call, and they were the bulk of
 * the 17 Postgres round trips the endpoint was measured at. None of them can
 * change except through a signal write, and every path that writes one already
 * calls `invalidateTasteCaches`, which clears this key. So the cache is exact
 * rather than merely tolerable: a stale read is only possible in the window
 * between a play finishing and its signal landing, where the correct radio is
 * the one computed a moment ago anyway.
 *
 * The TTL is a backstop for signals that arrive by paths that don't invalidate,
 * not the primary freshness mechanism.
 */
type RadioContext = {
  profile: TasteProfile | null;
  affinities: { artistId: string; score: number }[];
  genreAffinities: { genre: string; score: number }[];
  excluded: { trackIds: string[] };
};

async function getRadioContext(userId: string): Promise<RadioContext> {
  return cached(cacheKey("radioctx", userId), TTL.RADIO, async () => {
    const [profile, affinities, genreAffinities, excluded] = await Promise.all([
      getTasteProfile(userId),
      query<{ artistId: string; score: number }>(
        `SELECT "artistId", score FROM "ArtistAffinity"
         WHERE "userId" = $1 ORDER BY score DESC LIMIT 60`,
        [userId]
      ).catch(softFail("radio:artistAffinity", [])),
      query<{ genre: string; score: number }>(
        `SELECT genre, score FROM "GenreAffinity"
         WHERE "userId" = $1 AND score > 0 ORDER BY score DESC LIMIT 25`,
        [userId]
      ).catch(softFail("radio:genreAffinity", [])),
      fetchExclusions(userId),
    ]);
    return { profile, affinities, genreAffinities, excluded };
  });
}

async function fetchSeed(trackId: string) {
  return query<{ artistId: string | null; genres: string[] | null; genre: string | null }>(
    `SELECT t."artistId", a.genres, t.genre
     FROM "Track" t LEFT JOIN "Artist" a ON a.id = t."artistId"
     WHERE t.id = $1`,
    [trackId]
  )
    .then((r) =>
      r[0]
        ? { artistId: r[0].artistId, genres: r[0].genres?.length ? r[0].genres : r[0].genre ? [r[0].genre] : [] }
        : null
    )
    .catch(softFail("radio:seed", null));
}

/**
 * Tracks that must never surface: explicitly banned, currently snoozed, or
 * played in the last couple of hours (they'd feel like a bug, not a pick).
 */
async function fetchExclusions(userId: string): Promise<{ trackIds: string[] }> {
  const [banned, snoozed, justPlayed] = await Promise.all([
    query<{ targetId: string }>(
      `SELECT "targetId" FROM "TasteFeedback"
       WHERE "userId" = $1 AND kind = 'ban' AND target = 'track'`,
      [userId]
    ).catch(softFail("radio:exclusions:banned", [])),
    query<{ trackId: string }>(
      `SELECT "trackId" FROM "SnoozedTrack"
       WHERE "userId" = $1 AND "expiresAt" > NOW()`,
      [userId]
    ).catch(softFail("radio:exclusions:snoozed", [])),
    query<{ trackId: string }>(
      `SELECT DISTINCT "trackId" FROM "ListeningHistory"
       WHERE "userId" = $1 AND "playedAt" > NOW() - INTERVAL '2 hours'`,
      [userId]
    ).catch(softFail("radio:exclusions:justPlayed", [])),
  ]);

  return {
    trackIds: [
      ...banned.map((b) => b.targetId),
      ...snoozed.map((s) => s.trackId),
      ...justPlayed.map((p) => p.trackId),
    ],
  };
}

/**
 * Cached wrapper for the home page and other hot paths. The radio itself is
 * intentionally *not* cached when a seed track is involved — that call needs
 * to reflect what's playing right now.
 *
 * The key deliberately omits `limit`. It used to be `radio:{user}:{limit}`,
 * which meant `invalidateTasteCaches` — deleting `radio:{user}` — never matched
 * anything, so this cache was invalidated by nothing at all and a user's radio
 * could ignore their feedback for as long as the entry lived. Caching the
 * largest reasonable list once and slicing per caller both fixes the
 * invalidation and stops two different limits doing the same work twice.
 */
export async function getCachedRadio(userId: string, limit = 20): Promise<RadioTrack[]> {
  const tracks = await cached(cacheKey("radio", userId), 120, () =>
    buildRadio(userId, { limit: 50 }),
  );
  return (tracks ?? []).slice(0, limit);
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
