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
  artist?: { id: number; name: string; picture_medium?: string; picture_big?: string };
  album?: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

export interface DzArtistLite {
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

/*
 * There used to be a `getGenreArtists` here, backed by a
 * normalised-genre → Deezer-genre-id table and `/genre/<id>/artists`.
 *
 * Both are gone because both were wrong. The endpoint stopped honouring the
 * genre id — verified live, every id returns the same geo-localised
 * popular-artist list — and its search fallback matched on artist *name*, so
 * "metal" returned acts called "Metal!" and "M.E.T.A.L.". The id table had
 * independently rotted too: `/genre` lists only 22 top-level genres, so the
 * afrobeats/amapiano (2228) and k-pop (2226) entries pointed at nothing, and
 * `country: 2` was actually "African Music".
 *
 * Deleted rather than deprecated: a broken exported function is an invitation.
 * `getGenreSeedArtists` below is the working replacement and has the same shape.
 */

// ── Genre → artists, via playlists ──────────────────────────────────────────

/**
 * Extra spelling variants for matching a genre against a playlist *title*.
 *
 * The general mechanism is `squash()` — strip everything but letters and digits
 * from both sides and test for a substring, which already handles the common
 * cases ("lo-fi" matches "chill lofi", "k-pop" matches "Top K-Pop", "drum &
 * bass" matches "Drum & Bass"). This table exists only for the handful where
 * squashing isn't enough, e.g. "rnb" never appears literally in "R&B Hits",
 * which squashes to "rbhits".
 *
 * Deliberately *not* imported from `lib/genres.ts`: that module pulls in React
 * icon components, and this one runs in API routes and background jobs. These
 * are provider query-shaping terms, which is the same thing DEEZER_GENRE_IDS
 * above already is.
 */
const GENRE_TITLE_VARIANTS: Record<string, string[]> = {
  rnb: ['rnb', 'rb', 'rhythmandblues'],
  edm: ['edm', 'dance', 'electrodance'],
  'hip-hop': ['hiphop', 'rap'],
  'drum & bass': ['drumbass', 'dnb'],
  'k-pop': ['kpop'],
  'j-pop': ['jpop', 'japanese'],
  anime: ['anime', 'anisong'],
  'lo-fi': ['lofi'],
  afrobeats: ['afrobeats', 'afrobeat', 'afropop'],
  amapiano: ['amapiano', 'piano'],
  electronic: ['electronic', 'electro'],
  alternative: ['alternative', 'altrock'],
  emo: ['emo', 'poppunk'],
  bollywood: ['bollywood', 'hindi'],
};

/** How many on-topic playlists to aggregate. Enough to let agreement emerge. */
const MAX_GENRE_PLAYLISTS = 4;

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface DzPlaylistLite {
  id: number;
  title?: string;
  nb_tracks?: number;
}

/**
 * Artists that actually represent a genre.
 *
 * ── Why this doesn't use `/genre/<id>/artists` ──────────────────────────────
 *
 * Because that endpoint does not work. Verified against the live API: it
 * returns the *same* geo-localised popular-artist list for every genre id —
 * pop, metal, classical and jazz all come back with the identical set — and it
 * ignores `limit` too. `/chart/<id>/artists` behaves the same way. Whatever
 * those endpoints did once, today the genre id is not honoured.
 *
 * The old search fallback is no better: `/search/artist?q=metal` matches on
 * artist *name*, so it returns acts called "Metal!", "Metal & Beats" and
 * "M.E.T.A.L." rather than metal artists.
 *
 * Two of the ids in DEEZER_GENRE_IDS are also wrong on their own terms —
 * `/genre` lists only 22 top-level genres, and 2228 (afrobeats/amapiano) and
 * 2226 (k-pop) aren't among them, while id 2 is "African Music" rather than
 * Country.
 *
 * ── What works instead ─────────────────────────────────────────────────────
 *
 * Playlists. `/search/playlist?q=amapiano` finds playlists whose curators have
 * already done the genre classification, and a playlist's tracks carry full
 * artist objects — including images, so the picker needs no extra calls.
 *
 * Two filters make it accurate rather than merely plausible:
 *
 *   1. Only keep playlists whose *title* names the genre. Searching "amapiano"
 *      also returns "Afro House", and "lo-fi" returns "Chill Out Musik"; both
 *      drag in artists from an adjacent genre.
 *   2. Rank artists by how many of those playlists they appear in, not by
 *      position. One curator slipping Tame Impala into a K-pop playlist is
 *      noise; an artist three separate curators filed under the genre is a real
 *      signal. This is what turns a plausible list into a correct one.
 *
 * Costs one search plus up to four playlist reads per genre, cached for
 * TTL.EXT_GENRE_POOL with a stale fallback, and keyed on the genre alone — so
 * the popular genres are essentially always warm across all users.
 */

/**
 * The shared step: find the genre's on-topic playlists and read their tracks.
 *
 * Returned as one array *per playlist* rather than flattened, because the
 * artist ranking below needs to know how many distinct playlists an artist
 * appeared in — flattening first would throw away exactly the signal that makes
 * the result accurate.
 *
 * Cached independently of any `limit`, so the artist picker and the genre browse
 * share one cache entry and one set of provider calls instead of each paying for
 * its own.
 */
async function genrePlaylistTracks(genre: string): Promise<DzTrackLite[][]> {
  const g = genre.toLowerCase().trim();

  return (
    (await cachedWithStale(
      cacheKey('ext', 'dz', 'genreplaylists', g),
      TTL.EXT_GENRE_POOL,
      async () => {
        const found = await dz<{ data: DzPlaylistLite[] }>(
          `/search/playlist?q=${encodeURIComponent(g)}&limit=12`,
          'genre.playlistSearch',
        );

        const terms = GENRE_TITLE_VARIANTS[g] ?? [squash(g)];
        const onTopic = (found?.data ?? [])
          .filter((p) => {
            const t = squash(p.title ?? '');
            return t && terms.some((term) => term && t.includes(term));
          })
          .slice(0, MAX_GENRE_PLAYLISTS);

        if (onTopic.length === 0) return null;

        const lists = await Promise.all(
          onTopic.map((p) =>
            dz<{ data: DzTrackLite[] }>(
              `/playlist/${p.id}/tracks?limit=100`,
              'genre.playlistTracks',
            ),
          ),
        );

        const out = lists.map((l) => l?.data ?? []).filter((l) => l.length > 0);
        return out.length > 0 ? out : null;
      },
      { label: `catalog.genrePlaylists:${g}` },
    )) ?? []
  );
}

export async function getGenreSeedArtists(
  genre: string,
  limit = 20,
): Promise<DzArtistLite[]> {
  const lists = await genrePlaylistTracks(genre);
  if (lists.length === 0) return [];

  /*
   * `lists` counts distinct playlists the artist appeared in — the
   * cross-curator agreement that does the real filtering. `tracks` only
   * breaks ties within the same agreement level.
   */
  const ranked = new Map<
    number,
    { artist: DzArtistLite; lists: number; tracks: number }
  >();

  for (const list of lists) {
    const seenHere = new Set<number>();
    for (const t of list) {
      const a = t?.artist;
      if (!a?.id || !a.name) continue;

      const entry = ranked.get(a.id) ?? {
        artist: {
          id: a.id,
          name: a.name,
          picture_medium: a.picture_medium,
          picture_big: a.picture_big,
        },
        lists: 0,
        tracks: 0,
      };
      entry.tracks += 1;
      if (!seenHere.has(a.id)) {
        seenHere.add(a.id);
        entry.lists += 1;
      }
      ranked.set(a.id, entry);
    }
  }

  return Array.from(ranked.values())
    .sort((a, b) => b.lists - a.lists || b.tracks - a.tracks)
    .slice(0, limit)
    .map((e) => e.artist);
}

/**
 * Tracks for a genre, from the same curated playlists.
 *
 * This is the genre-browse counterpart to `getGenreSeedArtists`, and exists
 * because Deezer's genre id space doesn't cover everything we offer: amapiano,
 * drill, lo-fi, highlife, gqom and anime have no id, and the keyword fallback
 * that used to handle them (`/search?q=genre:"Metal"`) matched on *title* and
 * returned things like "Classical Option" and "GENREBENDER".
 *
 * Interleaved across playlists rather than concatenated, so the first screen of
 * a browse isn't one playlist's opening run.
 */
export async function getGenreTracks(
  genre: string,
  limit = 30,
): Promise<VirtualTrack[]> {
  const lists = await genrePlaylistTracks(genre);
  if (lists.length === 0) return [];

  const picked: (VirtualTrack | null)[] = [];
  const depth = Math.max(...lists.map((l) => l.length), 0);

  for (let i = 0; i < depth && picked.length < limit * 2; i++) {
    for (const list of lists) {
      if (list[i]) picked.push(toVirtual(list[i]));
    }
  }

  return compact(picked).slice(0, limit);
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
    // `getGenreSeedArtists`, not `getGenreArtists` — the latter's endpoint
    // stopped honouring the genre id, so every pool was being seeded from the
    // same regional popular-artist list regardless of the user's taste. See the
    // analysis on `getGenreSeedArtists`.
    Promise.all(genres.map((g) => getGenreSeedArtists(g, 12))),
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

