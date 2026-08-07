import { query, softFail } from "@/lib/sql";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { getTasteProfile, normaliseGenre, type TasteProfile } from "@/lib/taste";

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

  const [profile, seed, affinities, genreAffinities, excluded] = await Promise.all([
    getTasteProfile(userId),
    opts.seedTrackId ? fetchSeed(opts.seedTrackId) : Promise.resolve(null),
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

  // 1. Gather. Each source runs independently and failures are isolated —
  //    a broken source degrades the mix, it doesn't empty it.
  const candidates = await gatherCandidates(userId, {
    artistIds: positiveArtistIds,
    genres: topGenres,
    bannedArtistIds,
    // Pull well beyond `limit` — scoring and diversification both discard a
    // lot, and a thin candidate pool produces a repetitive radio.
    poolSize: Math.max(220, limit * 10),
  });

  // 2. Score.
  const discovery = clamp(profile?.discovery ?? 0.35, 0, 1);
  const eraCenter = profile?.eraCenter ?? null;
  const eraSpread = profile?.eraSpread ?? 15;
  const now = Date.now();

  const seen = new Set<string>();
  const scored: { c: Candidate; score: number; reason: string }[] = [];

  for (const c of candidates) {
    if (excludeSet.has(c.id) || seen.has(c.id)) continue;
    if (!c.audioUrl || c.audioUrl === "pending") continue; // unplayable
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
 */
export async function getCachedRadio(userId: string, limit = 20): Promise<RadioTrack[]> {
  const key = cacheKey("radio", userId, limit);
  const cached = await cacheGet<RadioTrack[]>(key);
  if (cached?.length) return cached;

  const tracks = await buildRadio(userId, { limit });
  if (tracks.length > 0) await cacheSet(key, tracks, 120);
  return tracks;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
