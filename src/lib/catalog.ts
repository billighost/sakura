/**
 * Virtual catalogue — track listings hydrated from Deezer at read time.
 *
 * The problem this solves: mixes and radio need a *pool* of candidate tracks
 * that is broad across genres, but the only way to widen that pool with the
 * old design was to insert more `Track` rows. At ~1 KB of row plus indexes per
 * track, covering even a modest slice of a dozen genres is hundreds of MB —
 * on a 500 MB budget that is the entire database spent on rows nobody has ever
 * played.
 *
 * So we stop storing the catalogue and store the *taste* instead. Postgres
 * keeps only what's genuinely ours and can't be re-derived:
 *
 *   - who the user is, what they played, what they liked
 *   - GenreAffinity / ArtistAffinity — the actual taste model
 *   - Track rows for songs that have really been fetched and played
 *
 * Everything else — "what are 40 good afrobeats tracks", "who sounds like
 * Burna Boy" — is a question Deezer already answers for free, cached in Redis
 * with a stale fallback. A `VirtualTrack` is a candidate, not a row: it becomes
 * a real `Track` only if someone actually plays it.
 *
 * Cost of a mix rebuild: a handful of cached provider calls instead of a
 * permanent storage commitment.
 */

import { cachedWithStale, cacheKey, TTL } from './cache';
import { fetchJsonResilient } from './resilience';

const DEEZER_BASE = 'https://api.deezer.com';
const USER_AGENT = 'SakuraMusic/1.0 (https://github.com/sakura-music)';

/**
 * A candidate track that exists in the provider's catalogue but not in our DB.
 *
 * `id` is deliberately namespaced `deezer-<n>`. The player already treats a
 * `deezer-` prefixed id as "resolve this before playing", so a virtual track
 * flows through the existing queue, mix and radio paths untouched and only
 * materialises into a real row at play time.
 */
export interface VirtualTrack {
  id: string;
  deezerId: number;
  title: string;
  artistName: string;
  artistDeezerId: number | null;
  albumTitle: string | null;
  coverUrl: string | null;
  duration: number;
  /** Provider popularity rank, when the endpoint exposes one. */
  rank: number | null;
}

interface DzTrackLite {
  id: number;
  title: string;
  duration: number;
  rank?: number;
  artist?: { id: number; name: string; picture_medium?: string };
  album?: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

interface DzArtistLite {
  id: number;
  name: string;
  picture_medium?: string;
  picture_big?: string;
  nb_fan?: number;
}

async function dz<T>(endpoint: string, op: string): Promise<T | null> {
  return fetchJsonResilient<T>(`${DEEZER_BASE}${endpoint}`, {
    provider: 'deezer',
    op,
    headers: { 'User-Agent': USER_AGENT },
    revalidate: 3600,
    timeoutMs: 6000,
    attempts: 3,
  });
}

function toVirtual(t: DzTrackLite): VirtualTrack | null {
  if (!t?.id || !t.title) return null;
  return {
    id: `deezer-${t.id}`,
    deezerId: t.id,
    title: t.title,
    artistName: t.artist?.name ?? 'Unknown Artist',
    artistDeezerId: t.artist?.id ?? null,
    albumTitle: t.album?.title ?? null,
    coverUrl: t.album?.cover_big ?? t.album?.cover_medium ?? null,
    duration: t.duration ?? 0,
    rank: t.rank ?? null,
  };
}

function compact(list: (VirtualTrack | null)[]): VirtualTrack[] {
  const seen = new Set<number>();
  const out: VirtualTrack[] = [];
  for (const t of list) {
    if (!t || seen.has(t.deezerId)) continue;
    seen.add(t.deezerId);
    out.push(t);
  }
  return out;
}

// ── Genre pools ─────────────────────────────────────────────────────────────

/**
 * Deezer's genre ids are a small fixed set, and its `/genre/<id>/artists`
 * endpoint is the cheapest way to turn "this person likes amapiano" into
 * actual artists. Mapping our normalised genre strings onto those ids keeps
 * the lookup to one call per genre.
 *
 * Unmapped genres fall through to a plain search, which is why the map doesn't
 * need to be exhaustive — it just makes the common cases one hop cheaper.
 */
const DEEZER_GENRE_IDS: Record<string, number> = {
  pop: 132,
  rap: 116,
  'hip hop': 116,
  hiphop: 116,
  rock: 152,
  dance: 113,
  electronic: 106,
  edm: 106,
  house: 113,
  rnb: 165,
  'r&b': 165,
  soul: 165,
  alternative: 85,
  indie: 85,
  jazz: 129,
  classical: 98,
  reggae: 144,
  afrobeats: 2228,
  afro: 2228,
  african: 2228,
  amapiano: 2228,
  latin: 197,
  reggaeton: 197,
  country: 2,
  metal: 464,
  folk: 466,
  blues: 153,
  kpop: 2226,
  'k-pop': 2226,
};

/** Artists that define a genre, per the provider's own ranking. */
export async function getGenreArtists(genre: string, limit = 25): Promise<DzArtistLite[]> {
  const g = genre.toLowerCase().trim();
  const genreId = DEEZER_GENRE_IDS[g];

  return (
    (await cachedWithStale(
      cacheKey('ext', 'dz', 'genreartists', g, limit),
      TTL.EXT_GENRE_POOL,
      async () => {
        if (genreId) {
          const data = await dz<{ data: DzArtistLite[] }>(
            `/genre/${genreId}/artists?limit=${limit}`,
            'genre.artists',
          );
          if (data?.data?.length) return data.data;
        }
        // Unmapped genre, or the genre endpoint came back empty.
        const search = await dz<{ data: DzArtistLite[] }>(
          `/search/artist?q=${encodeURIComponent(g)}&limit=${limit}`,
          'genre.artistSearch',
        );
        return search?.data ?? null;
      },
      { label: `catalog.genreArtists:${g}` },
    )) ?? []
  );
}

/** An artist's best-known tracks — the workhorse for mix and radio pools. */
export async function getArtistTopTracks(
  artistDeezerId: number,
  limit = 15,
): Promise<VirtualTrack[]> {
  const rows = await cachedWithStale(
    cacheKey('ext', 'dz', 'artisttop', artistDeezerId, limit),
    TTL.EXT_ARTIST_TOP,
    async () => {
      const data = await dz<{ data: DzTrackLite[] }>(
        `/artist/${artistDeezerId}/top?limit=${limit}`,
        'artist.top',
      );
      return data?.data ?? null;
    },
    { label: 'catalog.artistTop' },
  );

  return compact((rows ?? []).map(toVirtual));
}

/** Artists the provider considers similar — the discovery edge of the graph. */
export async function getRelatedArtists(
  artistDeezerId: number,
  limit = 12,
): Promise<DzArtistLite[]> {
  return (
    (await cachedWithStale(
      cacheKey('ext', 'dz', 'related', artistDeezerId, limit),
      TTL.EXT_RELATED,
      async () => {
        const data = await dz<{ data: DzArtistLite[] }>(
          `/artist/${artistDeezerId}/related?limit=${limit}`,
          'artist.related',
        );
        return data?.data ?? null;
      },
      { label: 'catalog.related' },
    )) ?? []
  );
}

/** Provider charts — the cold-start pool for a user with no signal at all. */
export async function getChartTracks(limit = 50): Promise<VirtualTrack[]> {
  const rows = await cachedWithStale(
    cacheKey('ext', 'dz', 'chart', limit),
    TTL.EXT_GENRE_POOL,
    async () => {
      const data = await dz<{ tracks?: { data: DzTrackLite[] } }>(
        `/chart/0?limit=${limit}`,
        'chart',
      );
      return data?.tracks?.data ?? null;
    },
    { label: 'catalog.chart' },
  );

  return compact((rows ?? []).map(toVirtual));
}

// ── Pool building ───────────────────────────────────────────────────────────

export interface PoolRequest {
  /** Normalised genre strings, strongest first. */
  genres: string[];
  /** Deezer artist ids the user already has affinity for. */
  seedArtistIds: number[];
  /** 0 = only known artists, 1 = reach hard for unfamiliar ones. */
  discovery?: number;
  limit?: number;
}

/**
 * Build a broad candidate pool by fanning out across genres and artists.
 *
 * The fan-out is bounded and runs concurrently — the point of moving the
 * catalogue out of Postgres was to make breadth cheap, and that only holds if
 * breadth costs one round of parallel cached calls rather than a serial walk.
 * Every leg degrades independently: a genre that fails contributes nothing and
 * the pool is simply built from the rest.
 */
export async function buildCandidatePool(req: PoolRequest): Promise<VirtualTrack[]> {
  const limit = req.limit ?? 200;
  const discovery = Math.min(1, Math.max(0, req.discovery ?? 0.35));

  // How many genres to reach into, and how far past the user's known artists.
  const genreCount = discovery > 0.5 ? 5 : 3;
  const genres = req.genres.slice(0, genreCount);
  const seeds = req.seedArtistIds.slice(0, 8);

  // Step 1: resolve genres and seed artists to a set of artist ids, in one
  // concurrent wave.
  const [genreArtistLists, relatedLists] = await Promise.all([
    Promise.all(genres.map((g) => getGenreArtists(g, 12))),
    // Related-artist expansion is what produces genuinely new names, so it
    // scales with the discovery dial rather than being a fixed cost.
    discovery > 0.2
      ? Promise.all(seeds.slice(0, 4).map((id) => getRelatedArtists(id, 8)))
      : Promise.resolve([] as DzArtistLite[][]),
  ]);

  const artistIds = new Set<number>(seeds);
  for (const list of genreArtistLists) {
    for (const a of list) if (a?.id) artistIds.add(a.id);
  }
  for (const list of relatedLists) {
    for (const a of list) if (a?.id) artistIds.add(a.id);
  }

  if (artistIds.size === 0) return getChartTracks(limit);

  // Step 2: pull top tracks per artist. Capped — a pool of 200 candidates
  // needs maybe 20 artists, and every extra artist is a provider call whose
  // results we'd immediately discard.
  const chosen = Array.from(artistIds).slice(0, 24);
  const perArtist = Math.max(4, Math.ceil(limit / chosen.length));

  const trackLists = await Promise.all(
    chosen.map((id) => getArtistTopTracks(id, Math.min(perArtist, 15))),
  );

  return compact(trackLists.flat()).slice(0, limit);
}

/**
 * Round-robin over artists so a generated list never opens with six songs by
 * the same person — the most obvious tell of a naive recommender.
 */
export function diversify(tracks: VirtualTrack[], limit: number, maxPerArtist = 3): VirtualTrack[] {
  const byArtist = new Map<string, VirtualTrack[]>();
  for (const t of tracks) {
    const key = t.artistName || 'unknown';
    const list = byArtist.get(key) ?? [];
    if (list.length < maxPerArtist) {
      list.push(t);
      byArtist.set(key, list);
    }
  }

  const buckets = Array.from(byArtist.values());
  for (let i = buckets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [buckets[i], buckets[j]] = [buckets[j], buckets[i]];
  }

  const out: VirtualTrack[] = [];
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
    if (!added) break;
    round++;
  }
  return out;
}

/**
 * Resolve the Deezer artist ids for artists we know by name.
 *
 * `Artist.deezerId` is already populated for anything enriched at download
 * time, so this is usually a single indexed read with no provider traffic at
 * all — the fan-out only pays for artists we've never enriched.
 */
export async function resolveArtistDeezerIds(
  rows: { id: string; name: string; deezerId: string | null }[],
): Promise<number[]> {
  const known = rows
    .map((r) => (r.deezerId ? parseInt(r.deezerId, 10) : NaN))
    .filter((n) => Number.isFinite(n));

  const unknown = rows.filter((r) => !r.deezerId).slice(0, 6);
  if (unknown.length === 0) return known;

  const looked = await Promise.all(
    unknown.map(async (r) => {
      const found = await cachedWithStale(
        cacheKey('ext', 'dz', 'artistid', r.name.toLowerCase().trim()),
        TTL.EXT_ARTIST,
        async () => {
          const data = await dz<{ data: DzArtistLite[] }>(
            `/search/artist?q=${encodeURIComponent(r.name)}&limit=1`,
            'artist.idLookup',
          );
          return data?.data?.[0]?.id ?? null;
        },
        { label: 'catalog.artistId' },
      );
      return found;
    }),
  );

  return [...known, ...looked.filter((n): n is number => typeof n === 'number')];
}

