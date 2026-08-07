import { query, execute, softFail } from "@/lib/sql";
import { getTasteProfile, normaliseGenre, ensureTasteProfile } from "@/lib/taste";
import { invalidateTasteCaches } from "@/lib/taste";

/**
 * Mix generation.
 *
 * Each mix is a different *question* about someone's taste, not a different
 * sort of the same query — that's what stops "Made for you" from being six
 * shuffles of one playlist:
 *
 *   Daily Mix N  — one per genre cluster they actually listen to
 *   On Repeat    — what they've genuinely worn out lately
 *   Discover     — artists they've never played, reachable from their taste
 *   Time Capsule — their old favourites, deliberately out of rotation
 *   Deep Cuts    — low-play tracks from artists they love
 *   <Time of day>— what they play at *this* hour, specifically
 *
 * Every generator returns null when it can't produce something worthwhile,
 * and the caller drops it. A thin-but-honest set of mixes beats padding the
 * shelf with three variations of the same fifteen songs.
 */

const MIX_TTL_DAYS = 3;
const MIN_MIX_SIZE = 8;
const TARGET_MIX_SIZE = 25;

type MixDraft = {
  kind: string;
  slot: number;
  label: string;
  subtitle: string | null;
  description: string;
  tint: "a" | "b";
  seedGenres: string[];
  trackIds: string[];
};

type TrackRow = {
  id: string;
  coverUrl: string | null;
  artistName: string | null;
};

export async function generateUserMixes(userId: string): Promise<number> {
  await ensureTasteProfile(userId);
  const profile = await getTasteProfile(userId);

  const drafts: (MixDraft | null)[] = [];

  const [dailyMixes, onRepeat, discover, timeCapsule, deepCuts, timeOfDay] = await Promise.all([
    buildDailyMixes(userId),
    buildOnRepeat(userId),
    buildDiscover(userId, profile?.discovery ?? 0.35),
    buildTimeCapsule(userId),
    buildDeepCuts(userId),
    buildTimeOfDay(userId),
  ]);

  drafts.push(...dailyMixes, onRepeat, discover, timeCapsule, deepCuts, timeOfDay);

  const valid = drafts.filter((d): d is MixDraft => d !== null && d.trackIds.length >= MIN_MIX_SIZE);

  // A brand-new account with no signal at all still needs something on the
  // shelf, or the home page reads as broken rather than as empty.
  if (valid.length === 0) {
    const starter = await buildStarter(userId);
    if (starter) valid.push(starter);
  }

  if (valid.length === 0) {
    // Nothing playable in the catalogue at all — clear stale mixes and stop.
    await execute(`DELETE FROM "UserMix" WHERE "userId" = $1`, [userId]).catch(() => {});
    return 0;
  }

  // Cover art: a mosaic of the first few distinct covers in the mix.
  const allTrackIds = [...new Set(valid.flatMap((m) => m.trackIds.slice(0, 12)))];
  const covers = allTrackIds.length
    ? await query<TrackRow>(
        `SELECT t.id, COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl", a.name AS "artistName"
         FROM "Track" t
         LEFT JOIN "Album" al ON al.id = t."albumId"
         LEFT JOIN "Artist" a ON a.id = t."artistId"
         WHERE t.id = ANY($1::text[])`,
        [allTrackIds]
      ).catch(softFail("mixes:covers", []))
    : [];
  const coverById = new Map(covers.map((c) => [c.id, c]));

  // Replace in one transaction-ish sequence. Delete-then-insert keeps mix ids
  // fresh, which matters: a stale id in a bookmarked /mix/<id> URL should 404
  // rather than silently render someone else's regenerated content.
  await execute(`DELETE FROM "UserMix" WHERE "userId" = $1`, [userId]);

  const values: string[] = [];
  const params: any[] = [userId];
  let p = 2;

  for (const mix of valid) {
    const mixCovers = [
      ...new Set(
        mix.trackIds
          .map((id) => coverById.get(id)?.coverUrl)
          .filter((c): c is string => !!c)
      ),
    ].slice(0, 4);

    // 10 placeholders here — must stay in lockstep with the 10 params pushed
    // below and with the column list in the INSERT.
    const ph = Array.from({ length: 10 }, () => `$${p++}`).join(", ");
    values.push(`($1, ${ph}, NOW() + INTERVAL '${MIX_TTL_DAYS} days')`);
    params.push(
      mix.kind,
      mix.slot,
      mix.label,
      mix.subtitle,
      mix.description,
      mix.tint,
      mixCovers[0] ?? null,
      mixCovers,
      mix.seedGenres,
      mix.trackIds
    );
  }

  // The column list has to match the push order above exactly.
  await execute(
    `INSERT INTO "UserMix"
       ("userId", kind, slot, label, subtitle, description, tint, "coverUrl", "coverUrls", "seedGenres", "trackIds", "expiresAt")
     VALUES ${values.join(", ")}`,
    params
  );

  await invalidateTasteCaches(userId);
  return valid.length;
}

// ── Individual mix builders ─────────────────────────────────────────────────

/**
 * Daily Mixes: cluster the artists someone likes by shared genre, then build
 * one mix per cluster. This is what makes a Daily Mix feel coherent — each is
 * a single mood, not a shuffle of everything they've ever played.
 */
async function buildDailyMixes(userId: string): Promise<(MixDraft | null)[]> {
  const topGenres = await query<{ genre: string; score: number }>(
    `SELECT genre, score FROM "GenreAffinity"
     WHERE "userId" = $1 AND score > 0
     ORDER BY score DESC LIMIT 4`,
    [userId]
  ).catch(softFail("mixes:dailyMixes", []));

  if (topGenres.length === 0) return [];

  const mixes = await Promise.all(
    topGenres.slice(0, 3).map(async (g, i) => {
      const tracks = await query<{ id: string; artistName: string }>(
        `SELECT DISTINCT ON (t.id) t.id, ar.name AS "artistName"
         FROM "Track" t
         JOIN "Artist" ar ON ar.id = t."artistId"
         LEFT JOIN "ArtistAffinity" aff ON aff."artistId" = ar.id AND aff."userId" = $1
         WHERE (
           EXISTS (SELECT 1 FROM unnest(COALESCE(ar.genres, ARRAY[]::text[])) x WHERE lower(x) = $2)
           OR lower(t.genre) = $2
         )
         AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
         AND COALESCE(aff.score, 0) > -3
         AND t.id NOT IN (
           SELECT "trackId" FROM "SnoozedTrack" WHERE "userId" = $1 AND "expiresAt" > NOW()
         )
         ORDER BY t.id, COALESCE(aff.score, 0) DESC
         LIMIT 400`,
        [userId, g.genre]
      ).catch(softFail("mixes:dailyMixes2", []));

      if (tracks.length < MIN_MIX_SIZE) return null;

      // Cap per artist so a Daily Mix doesn't become one artist's discography.
      const picked = diversifyByArtist(tracks, TARGET_MIX_SIZE, 3);
      if (picked.length < MIN_MIX_SIZE) return null;

      const featured = [...new Set(picked.map((t) => t.artistName).filter(Boolean))].slice(0, 3);

      return {
        kind: "daily",
        slot: i + 1,
        label: `Daily Mix ${i + 1}`,
        subtitle: featured.length ? `${featured.join(", ")} and more` : null,
        description: `Your ${g.genre} rotation, refreshed.`,
        tint: (i % 2 === 0 ? "a" : "b") as "a" | "b",
        seedGenres: [g.genre],
        trackIds: picked.map((t) => t.id),
      };
    })
  );

  return mixes;
}

/** On Repeat: what they've actually played most in the last month. */
async function buildOnRepeat(userId: string): Promise<MixDraft | null> {
  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT h."trackId" AS id, ar.name AS "artistName"
     FROM "ListeningHistory" h
     JOIN "Track" t ON t.id = h."trackId"
     LEFT JOIN "Artist" ar ON ar.id = t."artistId"
     WHERE h."userId" = $1
       AND h."playedAt" > NOW() - INTERVAL '30 days'
       AND h.completed = true
       AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     GROUP BY h."trackId", ar.name
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC, MAX(h."playedAt") DESC
     LIMIT 30`,
    [userId]
  ).catch(softFail("mixes:onRepeat", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  return {
    kind: "repeat",
    slot: 0,
    label: "On Repeat",
    subtitle: "The songs you keep coming back to",
    description: "Everything you've had on heavy rotation this month.",
    tint: "a",
    seedGenres: [],
    trackIds: tracks.map((t) => t.id),
  };
}

/**
 * Discover: artists they have *never* played, reachable from their genres.
 * The discovery dial widens or narrows how far it reaches.
 */
async function buildDiscover(userId: string, discovery: number): Promise<MixDraft | null> {
  const genres = await query<{ genre: string }>(
    `SELECT genre FROM "GenreAffinity"
     WHERE "userId" = $1 AND score > 0
     ORDER BY score DESC LIMIT $2`,
    [userId, discovery > 0.5 ? 8 : 4]
  ).catch(softFail("mixes:discover", []));

  if (genres.length === 0) return null;

  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT DISTINCT ON (t.id) t.id, ar.name AS "artistName"
     FROM "Track" t
     JOIN "Artist" ar ON ar.id = t."artistId"
     WHERE (
       EXISTS (SELECT 1 FROM unnest(COALESCE(ar.genres, ARRAY[]::text[])) x WHERE lower(x) = ANY($2::text[]))
       OR lower(t.genre) = ANY($2::text[])
     )
     AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     -- Never played by this user, and by an artist they've never played either
     AND NOT EXISTS (SELECT 1 FROM "ListeningHistory" h WHERE h."userId" = $1 AND h."trackId" = t.id)
     AND NOT EXISTS (
       SELECT 1 FROM "ArtistAffinity" aff
       WHERE aff."userId" = $1 AND aff."artistId" = ar.id AND aff.plays > 0
     )
     ORDER BY t.id, RANDOM()
     LIMIT 300`,
    [userId, genres.map((g) => g.genre)]
  ).catch(softFail("mixes:discover2", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  const picked = diversifyByArtist(tracks, TARGET_MIX_SIZE, 2);
  if (picked.length < MIN_MIX_SIZE) return null;

  return {
    kind: "discover",
    slot: 0,
    label: "Discover Weekly",
    subtitle: "Artists you haven't heard yet",
    description: "New-to-you music picked from the corners of what you already love.",
    tint: "b",
    seedGenres: genres.map((g) => g.genre).slice(0, 3),
    trackIds: picked.map((t) => t.id),
  };
}

/** Time Capsule: things they loved once and haven't played in months. */
async function buildTimeCapsule(userId: string): Promise<MixDraft | null> {
  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT h."trackId" AS id, ar.name AS "artistName"
     FROM "ListeningHistory" h
     JOIN "Track" t ON t.id = h."trackId"
     LEFT JOIN "Artist" ar ON ar.id = t."artistId"
     WHERE h."userId" = $1
       AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     GROUP BY h."trackId", ar.name
     HAVING MAX(h."playedAt") < NOW() - INTERVAL '90 days'
        AND COUNT(*) FILTER (WHERE h.completed) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 30`,
    [userId]
  ).catch(softFail("mixes:timeCapsule", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  return {
    kind: "throwback",
    slot: 0,
    label: "Time Capsule",
    subtitle: "You used to play these constantly",
    description: "Songs you loved a while back and haven't touched in months.",
    tint: "b",
    seedGenres: [],
    trackIds: tracks.map((t) => t.id),
  };
}

/** Deep Cuts: the tracks their favourite artists made that they never played. */
async function buildDeepCuts(userId: string): Promise<MixDraft | null> {
  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT DISTINCT ON (t.id) t.id, ar.name AS "artistName"
     FROM "ArtistAffinity" aff
     JOIN "Track" t   ON t."artistId" = aff."artistId"
     JOIN "Artist" ar ON ar.id = aff."artistId"
     WHERE aff."userId" = $1
       AND aff.score > 0
       AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM "ListeningHistory" h WHERE h."userId" = $1 AND h."trackId" = t.id
       )
     ORDER BY t.id, aff.score DESC
     LIMIT 300`,
    [userId]
  ).catch(softFail("mixes:deepCuts", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  const picked = diversifyByArtist(tracks, TARGET_MIX_SIZE, 3);
  if (picked.length < MIN_MIX_SIZE) return null;

  const featured = [...new Set(picked.map((t) => t.artistName).filter(Boolean))].slice(0, 3);

  return {
    kind: "deepcuts",
    slot: 0,
    label: "Deep Cuts",
    subtitle: featured.length ? `Unplayed ${featured.join(", ")}` : "From artists you love",
    description: "Album tracks from your favourite artists that you've never played.",
    tint: "a",
    seedGenres: [],
    trackIds: picked.map((t) => t.id),
  };
}

/**
 * Time-of-day mix: what this person plays *at this hour*, learned from the
 * hourOfDay signal. Falls back to a generic favourites mix if they don't have
 * a distinct pattern yet, because "Late Night" with random songs in it is
 * worse than no mix at all.
 */
async function buildTimeOfDay(userId: string): Promise<MixDraft | null> {
  const hour = new Date().getHours();
  const band = timeBand(hour);

  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT h."trackId" AS id, ar.name AS "artistName"
     FROM "ListeningHistory" h
     JOIN "Track" t ON t.id = h."trackId"
     LEFT JOIN "Artist" ar ON ar.id = t."artistId"
     WHERE h."userId" = $1
       AND h."hourOfDay" BETWEEN $2 AND $3
       AND h."msPlayed" > 30000
       AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     GROUP BY h."trackId", ar.name
     ORDER BY COUNT(*) DESC, MAX(h."playedAt") DESC
     LIMIT 30`,
    [userId, band.from, band.to]
  ).catch(softFail("mixes:timeOfDay", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  return {
    kind: "timeofday",
    slot: 0,
    label: band.label,
    subtitle: band.subtitle,
    description: band.description,
    tint: band.tint,
    seedGenres: [],
    trackIds: tracks.map((t) => t.id),
  };
}

/** For a user with no signal at all: what's popular platform-wide. */
async function buildStarter(userId: string): Promise<MixDraft | null> {
  const tracks = await query<{ id: string; artistName: string }>(
    `SELECT t.id, ar.name AS "artistName"
     FROM "Track" t
     LEFT JOIN "Artist" ar ON ar.id = t."artistId"
     LEFT JOIN (
       SELECT "trackId", COUNT(*)::int AS plays FROM "ListeningHistory"
       WHERE "playedAt" > NOW() - INTERVAL '30 days'
       GROUP BY "trackId"
     ) gp ON gp."trackId" = t.id
     WHERE t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
     ORDER BY COALESCE(gp.plays, 0) DESC, t."createdAt" DESC
     LIMIT 40`,
    []
  ).catch(softFail("mixes:starter", []));

  if (tracks.length < MIN_MIX_SIZE) return null;

  const picked = diversifyByArtist(tracks, TARGET_MIX_SIZE, 2);
  if (picked.length < MIN_MIX_SIZE) return null;

  return {
    kind: "starter",
    slot: 0,
    label: "Start Here",
    subtitle: "Popular right now",
    description: "Play a few of these and your mixes will start shaping themselves around you.",
    tint: "a",
    seedGenres: [],
    trackIds: picked.map((t) => t.id),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Round-robin over artists so a mix never opens with six songs by the same
 * person — the single most obvious tell of a naive recommender.
 */
function diversifyByArtist<T extends { id: string; artistName: string | null }>(
  tracks: T[],
  limit: number,
  maxPerArtist: number
): T[] {
  const byArtist = new Map<string, T[]>();
  for (const t of tracks) {
    const key = t.artistName ?? "unknown";
    const list = byArtist.get(key) ?? [];
    if (list.length < maxPerArtist) {
      list.push(t);
      byArtist.set(key, list);
    }
  }

  const buckets = Array.from(byArtist.values());
  // Shuffle bucket order so the same artist doesn't always lead the mix.
  for (let i = buckets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [buckets[i], buckets[j]] = [buckets[j], buckets[i]];
  }

  const out: T[] = [];
  let round = 0;
  while (out.length < limit) {
    let added = false;
    for (const bucket of buckets) {
      if (round < bucket.length) {
        out.push(bucket[round]);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break; // every bucket exhausted
    round++;
  }
  return out;
}

function timeBand(hour: number): {
  label: string;
  subtitle: string;
  description: string;
  tint: "a" | "b";
  from: number;
  to: number;
} {
  if (hour >= 5 && hour < 11) {
    return {
      label: "Morning Rotation",
      subtitle: "What you play to start the day",
      description: "Built from what you actually listen to in the mornings.",
      tint: "b",
      from: 5,
      to: 11,
    };
  }
  if (hour >= 11 && hour < 17) {
    return {
      label: "Afternoon Run",
      subtitle: "Your midday soundtrack",
      description: "The songs that get you through the middle of the day.",
      tint: "a",
      from: 11,
      to: 17,
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      label: "Evening Unwind",
      subtitle: "How you close out the day",
      description: "What you reach for once the day starts winding down.",
      tint: "b",
      from: 17,
      to: 22,
    };
  }
  // Late night wraps midnight; the query uses BETWEEN so give it a range that
  // doesn't span the wrap — 22:00–23:59 and 00:00–05:00 both land in "late",
  // and using 0–5 for the small hours keeps the common case correct.
  return hour >= 22
    ? {
        label: "Late Night",
        subtitle: "After-hours listening",
        description: "The stuff you only put on once it's properly dark.",
        tint: "a",
        from: 22,
        to: 23,
      }
    : {
        label: "Late Night",
        subtitle: "After-hours listening",
        description: "The stuff you only put on once it's properly dark.",
        tint: "a",
        from: 0,
        to: 5,
      };
}
