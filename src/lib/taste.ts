import { query, queryOne, execute, softFail } from "@/lib/sql";
import { cacheDel, cacheKey } from "@/lib/cache";

/**
 * The taste engine.
 *
 * Everything the platform knows about what a person likes funnels through here.
 * Three ideas hold it together:
 *
 * 1. **Every play is a graded signal, not a binary one.** Finishing a song is a
 *    strong yes; bailing four seconds in is a real no. `signalWeight` turns a
 *    raw play row into a number in roughly [-1, +1.5].
 *
 * 2. **Recency decays, it doesn't cliff.** What someone had on repeat last week
 *    matters more than what they wore out a year ago, but the old stuff never
 *    fully disappears. A 60-day half-life felt right for music: long enough
 *    that a phase persists, short enough that a new obsession takes over.
 *
 * 3. **Rebuilds are idempotent.** Affinities are recomputed from the source
 *    tables rather than incremented in place, so running the recompute twice
 *    lands in exactly the same state. That makes it safe to trigger from
 *    anywhere without coordination.
 */

// ── Tuning constants ────────────────────────────────────────────────────────
// Grouped here rather than scattered inline so the system's behaviour can be
// tuned in one place without re-reading every query.

/** Half-life for recency decay, in days. */
const DECAY_HALF_LIFE_DAYS = 60;

/** A play shorter than this is treated as an accident, not a signal at all. */
const MIN_MEANINGFUL_MS = 5_000;

/** Fraction of a track that counts as "they actually listened to this". */
const COMPLETION_THRESHOLD = 0.85;

/** Below this fraction, a skip is read as active rejection. */
const EARLY_SKIP_THRESHOLD = 0.25;

/** Explicit signals outweigh implicit ones by roughly this much. */
const WEIGHTS = {
  like: 3.0,
  love: 5.0,
  ban: -8.0,
  more: 2.0,
  less: -2.5,
  playlistAdd: 2.0,
  download: 1.5,
  seedArtist: 4.0,
  seedGenre: 3.0,
  snooze: -2.0,
} as const;

export type TasteProfile = {
  userId: string;
  onboarded: boolean;
  seedArtistIds: string[];
  seedGenres: string[];
  seedArtistNames: string[];
  topGenres: string[];
  topArtistIds: string[];
  discovery: number;
  eraCenter: number | null;
  eraSpread: number | null;
  avgTrackMs: number | null;
  skipRate: number;
  totalPlays: number;
  vector: TasteVector | null;
  computedAt: Date;
};

export type TasteVector = {
  genres: Record<string, number>;
  eras: Record<string, number>;
  hours: Record<string, number>;
  artists: Record<string, number>;
};

export type PlaySignal = {
  trackId: string;
  msPlayed: number;
  durationMs: number;
  completed?: boolean;
  skipped?: boolean;
  skipAtMs?: number | null;
  context?: string | null;
  contextId?: string | null;
  autoplay?: boolean;
  playedAt?: string | Date;
};

// ── Signal scoring ──────────────────────────────────────────────────────────

/**
 * Turn one play into a signed weight.
 *
 * The shape matters more than the exact numbers: a completed play is worth
 * about 1.0, a full replay-worthy listen slightly more, an early skip is
 * negative, and a mid-track skip sits near zero because it's genuinely
 * ambiguous — people skip songs they like when the mood is wrong.
 */
export function signalWeight(s: {
  msPlayed: number;
  durationMs: number;
  completed?: boolean;
  skipped?: boolean;
  autoplay?: boolean;
}): number {
  const { msPlayed, durationMs } = s;

  // Too short to mean anything. Not a rejection — a misclick or a hasty browse.
  if (msPlayed < MIN_MEANINGFUL_MS) return 0;

  // Without a known duration we can only say "they listened for a while".
  if (!durationMs || durationMs <= 0) {
    return msPlayed > 60_000 ? 0.6 : 0.2;
  }

  const ratio = msPlayed / durationMs;
  let weight: number;

  if (s.completed || ratio >= COMPLETION_THRESHOLD) {
    // Ratios above 1 mean they replayed or scrubbed back — a strong signal.
    weight = ratio > 1.4 ? 1.5 : 1.0;
  } else if (ratio < EARLY_SKIP_THRESHOLD) {
    // Ramp from -1.0 (instant skip) up toward 0 at the threshold, so the
    // penalty is proportional to how fast they bailed.
    weight = -1.0 + (ratio / EARLY_SKIP_THRESHOLD) * 0.85;
  } else {
    // The ambiguous middle: mild positive, scaled by how far they got.
    weight = (ratio - EARLY_SKIP_THRESHOLD) / (COMPLETION_THRESHOLD - EARLY_SKIP_THRESHOLD) * 0.7;
  }

  // A track the radio queued says less about taste than one they chose.
  // Skips of autoplay picks still count fully — that's exactly the feedback
  // the radio needs to correct itself.
  if (s.autoplay && weight > 0) weight *= 0.65;

  return weight;
}

/** Exponential recency decay. 1.0 today, 0.5 at one half-life, and so on. */
export function decayFactor(playedAt: Date | string, now = new Date()): number {
  const then = playedAt instanceof Date ? playedAt : new Date(playedAt);
  const days = (now.getTime() - then.getTime()) / 86_400_000;
  if (!isFinite(days) || days < 0) return 1;
  return Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

/**
 * Mean decay across a group of plays spread between two timestamps.
 *
 * A rolled-up row records that a track was played N times between `first` and
 * `last`, but not when each play happened. Decaying the whole group at `last`
 * — the obvious shortcut — treats every play as though it happened at the most
 * recent one, which inflates old listening enormously: a track played seven
 * times from 400 down to 150 days ago scored ~170% too high in testing, and
 * that was enough to reorder the user's top artists.
 *
 * Assuming the plays are spread evenly across the interval, the right factor is
 * the average of the decay curve over it rather than its endpoint. For
 * decay(d) = e^(-λd), that average has a closed form:
 *
 *     (e^(-λ·dLast) - e^(-λ·dFirst)) / (λ · (dFirst - dLast))
 *
 * Even spread is an assumption, but a far better one than "all at the end", and
 * it degrades gracefully: as the interval shrinks the expression converges on
 * the plain point decay, which is what the degenerate branch returns directly.
 */
export function meanDecayFactor(
  first: Date | string,
  last: Date | string,
  now = new Date(),
): number {
  const dFirst = (now.getTime() - new Date(first).getTime()) / 86_400_000;
  const dLast = (now.getTime() - new Date(last).getTime()) / 86_400_000;

  if (!isFinite(dFirst) || !isFinite(dLast)) return 1;
  const oldest = Math.max(dFirst, dLast, 0);
  const newest = Math.max(Math.min(dFirst, dLast), 0);

  const lambda = Math.LN2 / DECAY_HALF_LIFE_DAYS;
  const span = oldest - newest;

  // Everything inside a day is a point as far as a 60-day half-life cares, and
  // the closed form divides by the span.
  if (span < 1) return Math.pow(0.5, newest / DECAY_HALF_LIFE_DAYS);

  return (Math.exp(-lambda * newest) - Math.exp(-lambda * oldest)) / (lambda * span);
}

// ── Profile reads ───────────────────────────────────────────────────────────

export async function getTasteProfile(userId: string): Promise<TasteProfile | null> {
  return queryOne<TasteProfile>(
    `SELECT * FROM "TasteProfile" WHERE "userId" = $1`,
    [userId]
  );
}

/**
 * Read the profile, creating an empty one if this is the first time we've
 * looked. Callers can then rely on a non-null profile.
 */
export async function ensureTasteProfile(userId: string): Promise<TasteProfile> {
  const existing = await getTasteProfile(userId);
  if (existing) return existing;

  await execute(
    `INSERT INTO "TasteProfile" ("userId") VALUES ($1)
     ON CONFLICT ("userId") DO NOTHING`,
    [userId]
  );
  const created = await getTasteProfile(userId);
  if (created) return created;

  // Extremely unlikely (the row was deleted between insert and select), but
  // returning a sane in-memory default beats throwing on a home-page render.
  return {
    userId,
    onboarded: false,
    seedArtistIds: [],
    seedGenres: [],
    seedArtistNames: [],
    topGenres: [],
    topArtistIds: [],
    discovery: 0.35,
    eraCenter: null,
    eraSpread: null,
    avgTrackMs: null,
    skipRate: 0,
    totalPlays: 0,
    vector: null,
    computedAt: new Date(),
  };
}

export async function isOnboarded(userId: string): Promise<boolean> {
  const row = await queryOne<{ onboarded: boolean }>(
    `SELECT onboarded FROM "TasteProfile" WHERE "userId" = $1`,
    [userId]
  );
  return row?.onboarded ?? false;
}

// ── Signal ingestion ────────────────────────────────────────────────────────

/**
 * Record a batch of plays. Called from the client's flush endpoint, so it has
 * to tolerate partial garbage without losing the good rows — one malformed
 * entry shouldn't discard an entire session's listening data.
 */
export async function recordPlaySignals(userId: string, signals: PlaySignal[]): Promise<number> {
  const valid = signals.filter(
    (s) => s && typeof s.trackId === "string" && s.trackId.length > 0 && Number.isFinite(s.msPlayed)
  );
  if (valid.length === 0) return 0;

  // Cap per request so a buggy or hostile client can't write unbounded rows.
  const batch = valid.slice(0, 200);

  const trackIds: string[] = [];
  const ats: Date[] = [];
  const skippeds: boolean[] = [];
  const msPlayeds: number[] = [];
  const completeds: boolean[] = [];
  const skipAtMss: (number | null)[] = [];
  const contexts: (string | null)[] = [];
  const contextIds: (string | null)[] = [];
  const autoplays: boolean[] = [];
  const hourOfDays: number[] = [];
  const dayOfWeeks: number[] = [];

  for (const s of batch) {
    const playedAt = s.playedAt ? new Date(s.playedAt) : new Date();
    const at = isNaN(playedAt.getTime()) ? new Date() : playedAt;
    const durationMs = Math.max(0, s.durationMs || 0);
    const msPlayed = Math.max(0, Math.min(s.msPlayed, durationMs > 0 ? durationMs * 3 : s.msPlayed));
    const completed = s.completed ?? (durationMs > 0 && msPlayed / durationMs >= COMPLETION_THRESHOLD);
    const skipped = s.skipped ?? (!completed && durationMs > 0 && msPlayed / durationMs < COMPLETION_THRESHOLD);

    trackIds.push(s.trackId);
    ats.push(at);
    skippeds.push(skipped);
    msPlayeds.push(Math.round(msPlayed));
    completeds.push(completed);
    skipAtMss.push(s.skipAtMs != null ? Math.round(s.skipAtMs) : null);
    contexts.push(s.context ?? null);
    contextIds.push(s.contextId ?? null);
    autoplays.push(s.autoplay ?? false);
    hourOfDays.push(at.getHours());
    dayOfWeeks.push(at.getDay());
  }

  // Foreign-key violations (a track deleted mid-session or un-imported Deezer track)
  // shouldn't 500 the flush — JOIN "Track" ensures only valid tracks are recorded.
  //
  // `id` is omitted deliberately: it is a bigint identity column now, so the
  // database assigns it. It used to be a text UUID written by hand here, which
  // cost 37 bytes in the row plus another 47 in its index on the largest table
  // in the schema — for a value nothing ever read.
  try {
    await execute(
      `INSERT INTO "ListeningHistory"
         ("userId", "trackId", "playedAt", "skipped", "msPlayed", "completed",
          "skipAtMs", "context", "contextId", "autoplay", "hourOfDay", "dayOfWeek")
       SELECT $1, t.t_id, t.at, t.skipped, t.ms_played, t.completed,
              t.skip_at_ms, t.context, t.context_id, t.autoplay, t.hour_of_day, t.day_of_week
         FROM UNNEST(
           $2::text[], $3::timestamptz[], $4::boolean[], $5::int[], $6::boolean[],
           $7::int[], $8::text[], $9::text[], $10::boolean[], $11::int[], $12::int[]
         ) AS t(t_id, at, skipped, ms_played, completed, skip_at_ms, context, context_id, autoplay, hour_of_day, day_of_week)
         JOIN "Track" tr ON tr.id = t.t_id`,
      [userId, trackIds, ats, skippeds, msPlayeds, completeds, skipAtMss, contexts, contextIds, autoplays, hourOfDays, dayOfWeeks]
    );
  } catch (err) {
    console.error("[Taste] Failed to record play signals:", err);
    return 0;
  }

  return batch.length;
}

/** Record explicit feedback (love / ban / more / less). */
export async function recordFeedback(
  userId: string,
  target: "track" | "artist" | "genre",
  targetId: string,
  kind: "love" | "ban" | "more" | "less"
): Promise<void> {
  await execute(
    `INSERT INTO "TasteFeedback" (id, "userId", target, "targetId", kind)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     ON CONFLICT ("userId", target, "targetId")
     DO UPDATE SET kind = EXCLUDED.kind, "createdAt" = NOW()`,
    [userId, target, targetId, kind]
  );
  await invalidateTasteCaches(userId);
}

// ── Recomputation ───────────────────────────────────────────────────────────

/**
 * Rebuild every affinity and the cached profile from source data.
 *
 * Deliberately a full recompute rather than an incremental update: the volume
 * per user is small (thousands of rows at most), and idempotence is worth far
 * more than the microseconds saved. Any caller can fire this without worrying
 * about double-application.
 */
export async function recomputeTaste(userId: string): Promise<TasteProfile> {
  await ensureTasteProfile(userId);

  const profile = await getTasteProfile(userId);
  const seedArtistIds = profile?.seedArtistIds ?? [];
  const seedGenres = profile?.seedGenres ?? [];

  // 1. Pull every signal we have. One pass over history, joined to the
  //    catalogue so genre/era/artist all come back together.
  const plays = await query<{
    trackId: string;
    artistId: string | null;
    genres: string[] | null;
    trackGenre: string | null;
    releaseYear: number | null;
    duration: number;
    msPlayed: number;
    completed: boolean;
    skipped: boolean;
    autoplay: boolean;
    hourOfDay: number | null;
    playedAt: Date;
  }>(
    `SELECT h."trackId", t."artistId", a.genres, t.genre AS "trackGenre",
            al."releaseYear", t.duration, h."msPlayed", h.completed,
            h.skipped, h.autoplay, h."hourOfDay", h."playedAt"
     FROM "ListeningHistory" h
     JOIN "Track" t   ON t.id = h."trackId"
     LEFT JOIN "Artist" a ON a.id = t."artistId"
     LEFT JOIN "Album"  al ON al.id = t."albumId"
     WHERE h."userId" = $1
       AND h."playedAt" > NOW() - INTERVAL '18 months'
     ORDER BY h."playedAt" DESC
     LIMIT 20000`,
    [userId]
  );

  /**
   * Rolled-up plays that have aged out of the raw window.
   *
   * `pruneListeningHistory` folds old rows into one summary per (user, track),
   * so without this the recompute would see only the recent window and quietly
   * rewrite a long-standing profile as though the user had just arrived. Read
   * alongside the raw rows and replayed below as weighted aggregates.
   */
  const aggregates = await query<{
    trackId: string;
    artistId: string | null;
    genres: string[] | null;
    trackGenre: string | null;
    releaseYear: number | null;
    duration: number;
    plays: number;
    completions: number;
    skips: number;
    totalMsPlayed: string;
    signalSum: number;
    firstPlayedAt: Date;
    lastPlayedAt: Date;
  }>(
    `SELECT pa."trackId", t."artistId", a.genres, t.genre AS "trackGenre",
            al."releaseYear", t.duration,
            pa.plays, pa.completions, pa.skips, pa."totalMsPlayed", pa."signalSum",
            pa."firstPlayedAt", pa."lastPlayedAt"
       FROM "PlayAggregate" pa
       JOIN "Track" t   ON t.id = pa."trackId"
       LEFT JOIN "Artist" a ON a.id = t."artistId"
       LEFT JOIN "Album"  al ON al.id = t."albumId"
      WHERE pa."userId" = $1`,
    [userId]
  ).catch(softFail("taste:aggregates", []));

  const [favorites, feedback, playlistAdds, snoozes] = await Promise.all([
    query<{ trackId: string; artistId: string | null; genres: string[] | null; createdAt: Date }>(
      `SELECT f."trackId", t."artistId", a.genres, f."createdAt"
       FROM "Favorite" f
       JOIN "Track" t ON t.id = f."trackId"
       LEFT JOIN "Artist" a ON a.id = t."artistId"
       WHERE f."userId" = $1`,
      [userId]
    ).catch(softFail("taste:favorites", [])),
    query<{ target: string; targetId: string; kind: string }>(
      `SELECT target, "targetId", kind FROM "TasteFeedback" WHERE "userId" = $1`,
      [userId]
    ).catch(softFail("taste:feedback", [])),
    query<{ artistId: string | null; genres: string[] | null }>(
      `SELECT t."artistId", a.genres
       FROM "PlaylistTrack" pt
       JOIN "Playlist" p ON p.id = pt."playlistId"
       JOIN "Track" t    ON t.id = pt."trackId"
       LEFT JOIN "Artist" a ON a.id = t."artistId"
       WHERE p."userId" = $1`,
      [userId]
    ).catch(softFail("taste:playlistAdds", [])),
    query<{ trackId: string; artistId: string | null }>(
      `SELECT s."trackId", t."artistId"
       FROM "SnoozedTrack" s
       JOIN "Track" t ON t.id = s."trackId"
       WHERE s."userId" = $1 AND s."expiresAt" > NOW()`,
      [userId]
    ).catch(softFail("taste:snoozes", [])),
  ]);

  // 2. Accumulate.
  const artistScores = new Map<string, { score: number; plays: number; completions: number; skips: number; likes: number; last: Date | null }>();
  const genreScores = new Map<string, { score: number; plays: number; skips: number }>();
  const eraWeights = new Map<number, number>();
  const hourWeights = new Map<number, number>();

  const bumpArtist = (artistId: string | null, delta: number, opts?: { play?: boolean; completed?: boolean; skipped?: boolean; liked?: boolean; at?: Date }) => {
    if (!artistId) return;
    const cur = artistScores.get(artistId) ?? { score: 0, plays: 0, completions: 0, skips: 0, likes: 0, last: null };
    cur.score += delta;
    if (opts?.play) cur.plays += 1;
    if (opts?.completed) cur.completions += 1;
    if (opts?.skipped) cur.skips += 1;
    if (opts?.liked) cur.likes += 1;
    if (opts?.at && (!cur.last || opts.at > cur.last)) cur.last = opts.at;
    artistScores.set(artistId, cur);
  };

  const bumpGenres = (genres: string[] | null | undefined, delta: number, opts?: { play?: boolean; skipped?: boolean }) => {
    if (!genres?.length) return;
    // Split the weight across an artist's genres so a five-genre artist doesn't
    // outvote a single-genre one purely by being tagged more thoroughly.
    const share = delta / genres.length;
    for (const raw of genres) {
      const g = normaliseGenre(raw);
      if (!g) continue;
      const cur = genreScores.get(g) ?? { score: 0, plays: 0, skips: 0 };
      cur.score += share;
      if (opts?.play) cur.plays += 1;
      if (opts?.skipped) cur.skips += 1;
      genreScores.set(g, cur);
    }
  };

  /**
   * Counted variants, for rolled-up history.
   *
   * The single-play helpers above increment their counters by one, which is
   * right for a raw row and wrong for a summary standing in for fifty plays.
   * These take the counts directly so an aggregate contributes the same totals
   * the individual rows would have.
   */
  const bumpArtistBy = (
    artistId: string | null,
    delta: number,
    counts: { plays: number; completions: number; skips: number; at: Date | null },
  ) => {
    if (!artistId) return;
    const cur = artistScores.get(artistId) ?? { score: 0, plays: 0, completions: 0, skips: 0, likes: 0, last: null };
    cur.score += delta;
    cur.plays += counts.plays;
    cur.completions += counts.completions;
    cur.skips += counts.skips;
    if (counts.at && (!cur.last || counts.at > cur.last)) cur.last = counts.at;
    artistScores.set(artistId, cur);
  };

  const bumpGenresBy = (
    genres: string[] | null | undefined,
    delta: number,
    counts: { plays: number; skips: number },
  ) => {
    if (!genres?.length) return;
    const share = delta / genres.length;
    for (const raw of genres) {
      const g = normaliseGenre(raw);
      if (!g) continue;
      const cur = genreScores.get(g) ?? { score: 0, plays: 0, skips: 0 };
      cur.score += share;
      cur.plays += counts.plays;
      cur.skips += counts.skips;
      genreScores.set(g, cur);
    }
  };

  const now = new Date();
  let totalWeighted = 0;
  let totalDuration = 0;
  let durationCount = 0;
  let skipCount = 0;

  for (const p of plays) {
    const durationMs = (p.duration || 0) * 1000;
    const w = signalWeight({
      msPlayed: p.msPlayed,
      durationMs,
      completed: p.completed,
      skipped: p.skipped,
      autoplay: p.autoplay,
    });
    if (p.skipped) skipCount += 1;
    if (durationMs > 0) {
      totalDuration += durationMs;
      durationCount += 1;
    }
    if (w === 0) continue;

    const decayed = w * decayFactor(p.playedAt, now);
    totalWeighted += decayed;

    bumpArtist(p.artistId, decayed, {
      play: true,
      completed: p.completed,
      skipped: p.skipped,
      at: p.playedAt,
    });

    const genreList = p.genres?.length ? p.genres : p.trackGenre ? [p.trackGenre] : null;
    bumpGenres(genreList, decayed, { play: true, skipped: p.skipped });

    if (decayed > 0) {
      if (p.releaseYear) eraWeights.set(p.releaseYear, (eraWeights.get(p.releaseYear) ?? 0) + decayed);
      if (p.hourOfDay != null) hourWeights.set(p.hourOfDay, (hourWeights.get(p.hourOfDay) ?? 0) + decayed);
    }
  }

  /**
   * Replay the rolled-up plays.
   *
   * A summary row stands in for `plays` individual plays, so it contributes the
   * per-play weight multiplied by the count rather than once. Two deliberate
   * approximations, both conservative:
   *
   *   - Decay is the mean of the decay curve across the group's span rather
   *     than its value at either endpoint. Using `lastPlayedAt` alone treats
   *     every play as though it were the most recent and overweights old
   *     listening badly — measured at 170% too high, enough to reorder a user's
   *     top artists.
   *   - The signal weight is NOT re-derived here. `signalSum` was computed at
   *     fold time from the individual rows, so it is exact; reconstructing it
   *     from counts and average milliseconds was measured 90% high, because
   *     signalWeight is continuous in the played/duration ratio and three
   *     completions plus one early skip is not "mostly completed".
   *
   * hourOfDay is not replayed: time-of-day mixes only look at recent listening,
   * and averaging an hour across months would be meaningless anyway.
   */
  for (const p of aggregates) {
    if (!p.plays || p.plays <= 0) continue;
    const durationMs = (p.duration || 0) * 1000;

    skipCount += p.skips;
    if (durationMs > 0) {
      totalDuration += durationMs * p.plays;
      durationCount += p.plays;
    }

    const signalSum = Number(p.signalSum) || 0;
    if (signalSum === 0) continue;

    const decayed = signalSum * meanDecayFactor(p.firstPlayedAt, p.lastPlayedAt, now);
    totalWeighted += decayed;

    bumpArtistBy(p.artistId, decayed, {
      plays: p.plays,
      completions: p.completions,
      skips: p.skips,
      at: p.lastPlayedAt,
    });

    const genreList = p.genres?.length ? p.genres : p.trackGenre ? [p.trackGenre] : null;
    bumpGenresBy(genreList, decayed, { plays: p.plays, skips: p.skips });

    if (decayed > 0 && p.releaseYear) {
      eraWeights.set(p.releaseYear, (eraWeights.get(p.releaseYear) ?? 0) + decayed);
    }
  }

  for (const f of favorites) {
    const d = WEIGHTS.like * decayFactor(f.createdAt, now);
    bumpArtist(f.artistId, d, { liked: true });
    bumpGenres(f.genres, d);
  }

  for (const a of playlistAdds) {
    bumpArtist(a.artistId, WEIGHTS.playlistAdd);
    bumpGenres(a.genres, WEIGHTS.playlistAdd);
  }

  for (const s of snoozes) {
    bumpArtist(s.artistId, WEIGHTS.snooze);
  }

  // Onboarding seeds. They fade as real listening accumulates — the seed is a
  // starting point, not a permanent thumb on the scale. Once someone has a few
  // hundred weighted plays their actual behaviour dominates entirely.
  const seedInfluence = Math.max(0, 1 - Math.abs(totalWeighted) / 300);
  for (const artistId of seedArtistIds) {
    bumpArtist(artistId, WEIGHTS.seedArtist * seedInfluence);
  }
  for (const genre of seedGenres) {
    const g = normaliseGenre(genre);
    if (!g) continue;
    const cur = genreScores.get(g) ?? { score: 0, plays: 0, skips: 0 };
    cur.score += WEIGHTS.seedGenre * seedInfluence;
    genreScores.set(g, cur);
  }

  // Explicit feedback applies last and hardest — it's the person telling us
  // directly, so it should be able to override accumulated implicit signal.
  for (const fb of feedback) {
    const w = WEIGHTS[fb.kind as keyof typeof WEIGHTS];
    if (typeof w !== "number") continue;
    if (fb.target === "artist") {
      bumpArtist(fb.targetId, w);
    } else if (fb.target === "genre") {
      const g = normaliseGenre(fb.targetId);
      if (g) {
        const cur = genreScores.get(g) ?? { score: 0, plays: 0, skips: 0 };
        cur.score += w;
        genreScores.set(g, cur);
      }
    }
  }

  // 3. Persist affinities. Delete-then-insert inside one statement pair keeps
  //    the rebuild idempotent and avoids stale rows for artists that dropped
  //    out of the window entirely.
  await execute(`DELETE FROM "ArtistAffinity" WHERE "userId" = $1`, [userId]);
  if (artistScores.size > 0) {
    const entries = Array.from(artistScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 500);
    const vals: string[] = [];
    const params: any[] = [userId];
    let i = 2;
    for (const [artistId, s] of entries) {
      vals.push(`($1, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(artistId, s.score, s.plays, s.completions, s.skips, s.likes, s.last);
    }
    await execute(
      `INSERT INTO "ArtistAffinity"
         ("userId", "artistId", score, plays, completions, skips, likes, "lastPlayedAt")
       VALUES ${vals.join(", ")}
       ON CONFLICT ("userId", "artistId") DO UPDATE SET
         score = EXCLUDED.score, plays = EXCLUDED.plays,
         completions = EXCLUDED.completions, skips = EXCLUDED.skips,
         likes = EXCLUDED.likes, "lastPlayedAt" = EXCLUDED."lastPlayedAt",
         "updatedAt" = NOW()`,
      params
    ).catch((e) => console.error("[Taste] artist affinity write failed:", e));
  }

  await execute(`DELETE FROM "GenreAffinity" WHERE "userId" = $1`, [userId]);
  if (genreScores.size > 0) {
    const entries = Array.from(genreScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 200);
    const vals: string[] = [];
    const params: any[] = [userId];
    let i = 2;
    for (const [genre, s] of entries) {
      vals.push(`($1, $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(genre, s.score, s.plays, s.skips);
    }
    await execute(
      `INSERT INTO "GenreAffinity" ("userId", genre, score, plays, skips)
       VALUES ${vals.join(", ")}
       ON CONFLICT ("userId", genre) DO UPDATE SET
         score = EXCLUDED.score, plays = EXCLUDED.plays,
         skips = EXCLUDED.skips, "updatedAt" = NOW()`,
      params
    ).catch((e) => console.error("[Taste] genre affinity write failed:", e));
  }

  // 4. Derive the summary.
  const topArtistIds = Array.from(artistScores.entries())
    .filter(([, s]) => s.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 30)
    .map(([id]) => id);

  const topGenres = Array.from(genreScores.entries())
    .filter(([, s]) => s.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 20)
    .map(([g]) => g);

  const { center: eraCenter, spread: eraSpread } = summariseEras(eraWeights);
  const avgTrackMs = durationCount > 0 ? Math.round(totalDuration / durationCount) : null;
  const skipRate = plays.length > 0 ? skipCount / plays.length : 0;

  // Discovery appetite: start from the onboarding answer, then let behaviour
  // move it. Someone who skips a lot of unfamiliar autoplay picks gets a more
  // conservative radio; someone who rides them out gets a bolder one.
  const discovery = deriveDiscovery(profile?.discovery ?? 0.35, plays);

  const vector: TasteVector = {
    genres: Object.fromEntries(
      Array.from(genreScores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 40)
        .map(([g, s]) => [g, round3(s.score)])
    ),
    eras: Object.fromEntries(Array.from(eraWeights.entries()).map(([y, w]) => [String(y), round3(w)])),
    hours: Object.fromEntries(Array.from(hourWeights.entries()).map(([h, w]) => [String(h), round3(w)])),
    artists: Object.fromEntries(
      Array.from(artistScores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 40)
        .map(([a, s]) => [a, round3(s.score)])
    ),
  };

  await execute(
    `UPDATE "TasteProfile" SET
       "topGenres" = $2, "topArtistIds" = $3, discovery = $4,
       "eraCenter" = $5, "eraSpread" = $6, "avgTrackMs" = $7,
       "skipRate" = $8, "totalPlays" = $9, vector = $10::jsonb,
       "computedAt" = NOW()
     WHERE "userId" = $1`,
    [
      userId,
      topGenres,
      topArtistIds,
      discovery,
      eraCenter,
      eraSpread,
      avgTrackMs,
      skipRate,
      plays.length,
      JSON.stringify(vector),
    ]
  );

  await invalidateTasteCaches(userId);

  const updated = await getTasteProfile(userId);
  return updated!;
}

// ── Onboarding ──────────────────────────────────────────────────────────────

/**
 * An artist picked during onboarding, as it arrives from the client.
 *
 * These come from the provider, so there is no `Artist.id` yet — the name is
 * the identity, and `saveOnboarding` upserts against the unique name index.
 */
export interface OnboardingArtist {
  name: string;
  deezerId?: number | null;
  imageUrl?: string | null;
  genres?: string[];
}

/** Cap on how many picks are materialised, as a guard against a crafted body. */
const MAX_SEED_ARTISTS = 50;

/**
 * Turn provider artist picks into real `Artist` rows and return their ids.
 *
 * This has to happen before the profile is written, because `ArtistAffinity`
 * has a foreign key to `Artist.id` — a `deezer-<n>` string cannot be stored in
 * `seedArtistIds` and still take part in the taste model. Storing only names
 * (which is what the write-only `seedArtistNames` column did) meant artist
 * picks were silently discarded the moment onboarding finished.
 *
 * Artist rows are cheap in a way `Track` rows are not — a few hundred bytes,
 * capped at what one person actually picked. And filling in `deezerId` here
 * pays for itself immediately: `resolveArtistDeezerIds` then finds these on an
 * indexed read, so the first mix build needs no provider lookups to use them.
 */
async function materialiseSeedArtists(artists: OnboardingArtist[]): Promise<string[]> {
  const byName = new Map<string, OnboardingArtist>();
  for (const a of artists) {
    const name = a.name?.trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, a);
    if (byName.size >= MAX_SEED_ARTISTS) break;
  }
  if (byName.size === 0) return [];

  const rows = await Promise.all(
    Array.from(byName.values()).map(async (a) => {
      const genres = dedupe(
        (a.genres ?? []).map(normaliseGenre).filter(Boolean) as string[]
      );
      /*
       * COALESCE on update so an artist we already enriched at download time
       * keeps its better metadata — the provider's onboarding thumbnail should
       * never overwrite a full image or a deezerId we already trust.
       */
      const row = await queryOne<{ id: string }>(
        `INSERT INTO "Artist" (id, name, "imageUrl", "deezerId", genres, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
         ON CONFLICT (name) DO UPDATE SET
           "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl"),
           "deezerId" = COALESCE("Artist"."deezerId", EXCLUDED."deezerId"),
           genres = CASE
             WHEN COALESCE(array_length("Artist".genres, 1), 0) = 0
               THEN EXCLUDED.genres
             ELSE "Artist".genres
           END
         RETURNING id`,
        [
          a.name.trim(),
          a.imageUrl ?? null,
          a.deezerId != null ? String(a.deezerId) : null,
          genres,
        ]
      ).catch((e) => {
        console.error("[Taste] seed artist upsert failed:", e);
        return null;
      });
      return row?.id ?? null;
    })
  );

  return rows.filter((id): id is string => typeof id === "string");
}

export async function saveOnboarding(
  userId: string,
  input: {
    artistIds?: string[];
    artists?: OnboardingArtist[];
    genres?: string[];
    discovery?: number;
  }
): Promise<void> {
  await ensureTasteProfile(userId);

  // Provider picks become rows first, so their real ids can join the explicit
  // ones. Names are kept alongside as a durable record independent of the row.
  const materialised = await materialiseSeedArtists(input.artists ?? []);
  const artistNames = dedupe(
    (input.artists ?? []).map((a) => a.name?.trim()).filter(Boolean) as string[]
  ).slice(0, MAX_SEED_ARTISTS);

  const artistIds = dedupe([...(input.artistIds ?? []), ...materialised]).slice(0, MAX_SEED_ARTISTS);
  const genres = dedupe((input.genres ?? []).map(normaliseGenre).filter(Boolean) as string[]).slice(0, 30);
  const discovery = clamp(input.discovery ?? 0.35, 0, 1);

  await execute(
    `UPDATE "TasteProfile" SET
       onboarded = true,
       "seedArtistIds" = $2,
       "seedArtistNames" = $3,
       "seedGenres" = $4,
       discovery = $5,
       "computedAt" = NOW()
     WHERE "userId" = $1`,
    [userId, artistIds, artistNames, genres, discovery]
  );

  await recomputeTaste(userId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Genre strings arrive from Deezer, MusicBrainz and hand-entered data with
 * wildly inconsistent casing and punctuation. Folding them here stops
 * "Hip Hop", "hip-hop" and "HipHop" from being counted as three separate
 * tastes — which would quietly dilute the single strongest signal a user has.
 */
export function normaliseGenre(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const g = raw
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9&\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!g || g.length > 40) return null;

  const aliases: Record<string, string> = {
    "hip hop": "hip-hop",
    hiphop: "hip-hop",
    rap: "hip-hop",
    "r&b": "rnb",
    "r b": "rnb",
    "rhythm & blues": "rnb",
    "rhythm and blues": "rnb",
    "electronic dance music": "edm",
    dance: "edm",
    electro: "electronic",
    "alternative rock": "alternative",
    "indie rock": "indie",
    "afro beats": "afrobeats",
    afrobeat: "afrobeats",
    "afro pop": "afropop",
    "k pop": "k-pop",
    kpop: "k-pop",
    "drum and bass": "drum & bass",
    dnb: "drum & bass",
  };
  return aliases[g] ?? g;
}

function summariseEras(eraWeights: Map<number, number>): { center: number | null; spread: number | null } {
  if (eraWeights.size === 0) return { center: null, spread: null };
  let sum = 0;
  let weightSum = 0;
  for (const [year, w] of eraWeights) {
    if (year < 1900 || year > 2100) continue; // guard against junk metadata
    sum += year * w;
    weightSum += w;
  }
  if (weightSum === 0) return { center: null, spread: null };
  const center = sum / weightSum;

  let varianceSum = 0;
  for (const [year, w] of eraWeights) {
    if (year < 1900 || year > 2100) continue;
    varianceSum += w * Math.pow(year - center, 2);
  }
  const spread = Math.sqrt(varianceSum / weightSum);
  return { center: Math.round(center), spread: Math.max(2, Math.round(spread)) };
}

/**
 * Nudge the discovery dial from how autoplay picks actually landed.
 *
 * Only autoplay plays count here: a person choosing an unfamiliar song
 * themselves says nothing about how much *unrequested* novelty they'll
 * tolerate, which is the thing the radio needs to know.
 */
function deriveDiscovery(
  current: number,
  plays: { autoplay: boolean; completed: boolean; skipped: boolean }[]
): number {
  const auto = plays.filter((p) => p.autoplay);
  if (auto.length < 12) return clamp(current, 0, 1); // not enough evidence yet

  const kept = auto.filter((p) => p.completed).length;
  const keepRate = kept / auto.length;

  // Target sits between 0.15 and 0.8, moved toward wherever keepRate points.
  const target = clamp(0.15 + keepRate * 0.65, 0.15, 0.8);
  // Move only part of the way so the dial drifts rather than lurches.
  return clamp(current + (target - current) * 0.3, 0, 1);
}

export async function invalidateTasteCaches(userId: string): Promise<void> {
  await cacheDel(
    cacheKey("home", userId),
    cacheKey("taste", userId),
    cacheKey("radio", userId),
    // The radio scorer's cached inputs — affinities and exclusion lists. Signal
    // writes are the only thing that changes them, so this is where they have
    // to be dropped; without it the radio would keep scoring against
    // pre-feedback affinities until the TTL lapsed.
    cacheKey("radioctx", userId),
    // The candidate pool is derived from those same affinities, so it has to go
    // with them — otherwise feedback would reshape the scoring but keep drawing
    // from a pool built before the user said what they wanted.
    cacheKey("radio-pool", userId),
  );
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((x) => typeof x === "string" && x.trim().length > 0)));
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
