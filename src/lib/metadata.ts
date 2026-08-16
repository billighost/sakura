import { after } from 'next/server';
import {
  callProvider,
  fetchJsonResilient,
  HttpError,
  PacerOverflowError,
  RequestPacer,
} from './resilience';
import { cachedWithStale, cacheKey, TTL } from './cache';
import { execute, query } from './sql';

export interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium: string; cover_big?: string; release_date?: string };
  isrc?: string;
  contributors?: { id: number; name: string; role: string; picture_medium?: string }[];
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_medium: string;
  cover_big: string;
  release_date: string;
  genre_id?: number;
  nb_tracks: number;
  artist: { id: number; name: string };
  tracks?: { data: { id: number; title: string; track_position: number; duration: number; artist: { id: number; name: string } }[] };
  copyright?: string;
}

interface DeezerArtist {
  id: number;
  name: string;
  picture_medium: string;
  picture_big: string;
  nb_album: number;
  nb_fan: number;
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  'artist-credit'?: { name: string; artist: { id: string; name: string } }[];
  releases?: { id: string; title: string; date?: string; 'cover-art-archive'?: { front: boolean } }[];
  isrcs?: string[];
  tags?: { count: number; name: string }[];
  relations?: {
    type: string;
    target: string;
    'target-type'?: string;
    work?: { id: string; title: string };
    artist?: { name: string; id?: string };
    direction?: string;
    attributes?: string[];
    attribute?: string[];
  }[];
}

interface EnrichedMetadata {
  artist?: {
    deezerId: number;
    name: string;
    imageUrl?: string;
    bio?: string;
    genres?: string[];
  };
  album?: {
    deezerId: number;
    title: string;
    coverUrl?: string;
    releaseDate?: string;
    releaseYear?: number;
    genre?: string;
    copyright?: string;
    trackList?: { title: string; position: number; duration: number; artistId?: number; artistName?: string }[];
  };
  track?: {
    deezerId: number;
    isrc?: string;
    previewUrl?: string;
    contributors?: { name: string; role: string; imageUrl?: string }[];
  };
  credits?: { name: string; role: string }[];
  samples?: { trackId?: string; trackTitle: string; artistName: string; type: string }[];
}

const DEEZER_BASE = 'https://api.deezer.com';
const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const ITUNES_BASE = 'https://itunes.apple.com';

/**
 * MusicBrainz requires a User-Agent that identifies the application *and* gives
 * them a way to reach whoever runs it; clients that don't get blocked, and the
 * block is applied by UA string, so it outlives the deploy that earned it.
 *
 * The previous value was `SakuraMusic/1.0 (https://github.com/sakura-music)` —
 * a URL that does not exist. That satisfies the format check and fails the
 * actual purpose: when this client misbehaves (and it did — see the pacer),
 * MusicBrainz had no way to say so except by returning errors.
 *
 * `MUSICBRAINZ_CONTACT` should be an email or a real project URL. Without it we
 * fall back to the deployment's own hostname, which is at least reachable, and
 * warn once so the gap is visible rather than silently shipped.
 */
function buildUserAgent(): string {
  const contact = (process.env.MUSICBRAINZ_CONTACT || '').trim();
  if (contact) return `SakuraMusic/1.0 ( ${contact} )`;

  const host =
    (process.env.NEXTAUTH_URL || '').trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

  if (host) {
    console.warn(
      '[metadata] MUSICBRAINZ_CONTACT is unset; using the deployment URL in the ' +
        'MusicBrainz User-Agent. Set it to an email or project URL they can reach.',
    );
    return `SakuraMusic/1.0 ( ${host} )`;
  }

  console.warn(
    '[metadata] MUSICBRAINZ_CONTACT is unset and no deployment URL is available — ' +
      'MusicBrainz may refuse requests from this User-Agent.',
  );
  return 'SakuraMusic/1.0';
}

const USER_AGENT = buildUserAgent();

/**
 * Per-provider request timeout.
 *
 * Enrichment sits directly in the download path, so an unresponsive provider
 * is a stalled download from the user's point of view. Every one of these
 * lookups is optional — a missing genre or cover is a degraded result, not a
 * failed one — so it's always better to give up quickly and return what we
 * have than to wait out a hung connection.
 */
const PROVIDER_TIMEOUT_MS = 6000;

/**
 * MusicBrainz asks for ~1 request/second per client and enforces it with 503s.
 * It is also the slowest provider here by a wide margin, so it gets a longer
 * timeout, no retries, and a twitchier breaker than Deezer: when MB is
 * struggling the right move is to stop asking, not to try harder.
 */
const MB_TIMEOUT_MS = 8000;

/**
 * The gate that makes the sentence above true.
 *
 * It was a comment describing an intention, not a mechanism — `enrichMusicBrainz`
 * fans out with `Promise.all`, so a single track enrichment fired six requests
 * inside 40ms, MusicBrainz answered 503, and the breaker opened on a provider
 * that was perfectly healthy. Nothing was wrong except our own pacing.
 *
 * 1100ms rather than 1000ms because the limit is measured at their end, where
 * our clock skew and the network's jitter both count against us; the extra 10%
 * is cheaper than a block.
 *
 * Honest about its limits: this is per-process, so N concurrent Vercel instances
 * can still exceed 1 rps in aggregate. It fixes the burst that was actually
 * observed (one request's own fan-out), and `Retry-After` plus the breaker
 * handle the residual. A cross-instance limiter would need a Redis round trip
 * per call — real money, on the hot download path, to solve a problem that
 * shows up only under concurrency this app doesn't yet see.
 */
const mbPacer = new RequestPacer('musicbrainz', 1100);

/**
 * Paced MusicBrainz GET.
 *
 * Two details that look like style and are not:
 *
 * 1. The pacer wraps `callProvider`, not the other way round. Inside, the
 *    8s `AbortSignal.timeout` would start ticking while the call sat in the
 *    queue — six queued calls means the last one has spent 6.6s of its budget
 *    before the request is even sent, and it fails as a "timeout" against a
 *    provider that never saw it. That trips the breaker on our own queue.
 *
 * 2. It uses `callProvider` directly rather than `fetchJsonResilient`, because
 *    it needs the response's status and headers to honour `Retry-After`.
 *    `fetchJsonResilient` throws `HttpError` and drops the headers.
 */
async function fetchMusicBrainz<T>(endpoint: string, op: string): Promise<T | null> {
  const url = `${MUSICBRAINZ_BASE}${endpoint}`;

  try {
    return await mbPacer.run(() =>
      callProvider<T>(
        async (signal) => {
          const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal,
            next: { revalidate: 86400 },
          });

          if (res.status === 429 || res.status === 503) {
            // They have told us the interval we picked is too tight. Believe
            // them: hold the whole pacer, not just this call, or the next
            // queued request walks into the same wall.
            mbPacer.penalise(parseRetryAfter(res.headers.get('retry-after')));
          }

          if (!res.ok) throw new HttpError(res.status, url);
          return (await res.json()) as T;
        },
        {
          provider: 'musicbrainz',
          op,
          timeoutMs: MB_TIMEOUT_MS,
          // One attempt. A retry inside the same pacer slot is the exact
          // violation this whole mechanism exists to prevent, and every result
          // here is cached for 24h — the cost of a miss is one track enriched a
          // little less, not a failed request.
          attempts: 1,
        },
      ),
    );
  } catch (err) {
    // Overflow only: `callProvider` returns null instead of throwing.
    if (err instanceof PacerOverflowError) return null;
    throw err;
  }
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Clamped to
 * [1s, 60s]: a provider asking us to wait five minutes on the download path is
 * asking for a stalled download, and the breaker is the better tool for an
 * outage that long.
 */
function parseRetryAfter(header: string | null, fallbackMs = 5000): number {
  if (!header) return fallbackMs;

  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();

  if (!Number.isFinite(ms) || ms <= 0) return fallbackMs;
  return Math.min(Math.max(ms, 1000), 60_000);
}

async function fetchDeezer<T>(endpoint: string, op: string): Promise<T | null> {
  return fetchJsonResilient<T>(`${DEEZER_BASE}${endpoint}`, {
    provider: 'deezer',
    op,
    headers: { 'User-Agent': USER_AGENT },
    revalidate: 3600,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    attempts: 3,
  });
}

/**
 * iTunes Search — the fallback when Deezer can't identify a track.
 *
 * Chosen over the alternatives for one reason: it needs no key and no
 * account, so it can't silently stop working when a credential expires. Its
 * artwork is also higher resolution than Deezer's (the 100x100 URL rewrites
 * to any size), which is why it's worth consulting for covers even on the
 * path where Deezer succeeded but returned nothing usable.
 */
async function fetchItunes<T>(endpoint: string, op: string): Promise<T | null> {
  return fetchJsonResilient<T>(`${ITUNES_BASE}${endpoint}`, {
    provider: 'itunes',
    op,
    revalidate: 86400,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    attempts: 2,
  });
}

interface ItunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  artistId: number;
  collectionId: number;
  collectionName: string;
  artworkUrl100?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  copyright?: string;
}

/** iTunes serves 100×100 by default; the size is just a path segment. */
function itunesArtwork(url: string | undefined, size = 1000): string | undefined {
  return url?.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

export async function searchDeezerTrack(
  title: string,
  artist: string,
): Promise<DeezerTrack | null> {
  const query = `${artist} ${title}`.replace(/['"]/g, '').replace(/[^\w\s]/g, ' ');
  const key = cacheKey('ext', 'dz', 'track', query.toLowerCase().trim());

  return cachedWithStale(
    key,
    TTL.EXT_TRACK_SEARCH,
    async () => {
      const data = await fetchDeezer<{ data: DeezerTrack[] }>(
        `/search?q=${encodeURIComponent(query)}&limit=5`,
        'search.track',
      );
      if (!data?.data?.length) return null;

      const normalisedTitle = title.toLowerCase().replace(/[^\w]/g, '');
      const normalisedArtist = artist.toLowerCase().replace(/[^\w]/g, '');

      const best = data.data.find((t) => {
        const tTitle = t.title.toLowerCase().replace(/[^\w]/g, '');
        const tArtist = t.artist.name.toLowerCase().replace(/[^\w]/g, '');
        return tTitle.includes(normalisedTitle) || normalisedTitle.includes(tTitle)
          || tArtist.includes(normalisedArtist) || normalisedArtist.includes(tArtist);
      });

      return best || data.data[0];
    },
    { label: 'deezer.track' },
  );
}

/**
 * Find artwork for one track, by identifying it in a provider catalogue.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Spotify's embed payload — the keyless engine every public import goes through
 * first — carries per-track artwork for an *album* but not for a *playlist*: its
 * `trackList` entries are name/artist/duration only. The importer used to paper
 * over that by falling back to the entity's own cover, which for a playlist link
 * is the **playlist artwork**. So a 40-track import wrote one image onto all 40
 * `Track.coverUrl` rows and every song in the app showed the playlist's tile.
 *
 * The honest fix is to leave the cover absent at that point and resolve it per
 * track from a catalogue that actually has album art, which is what this does:
 * Deezer first (it's the catalogue the rest of the app is built on and its
 * search is already cached/circuit-broken), then iTunes, whose artwork is higher
 * resolution and whose `100x100` URL rewrites to any size.
 *
 * Returns null when neither provider can identify the track — a missing cover is
 * a placeholder in the UI, which is correct, and infinitely better than the
 * wrong cover, which is a lie.
 */
export async function findTrackCover(
  title: string,
  artist: string,
): Promise<string | null> {
  try {
    const dz = await searchDeezerTrack(title, artist);
    const dzCover = dz?.album?.cover_big || dz?.album?.cover_medium;
    if (dzCover) return dzCover;
  } catch {
    // Fall through to iTunes.
  }

  try {
    const it = await searchItunesTrack(title, artist);
    const itCover = itunesArtwork(it?.artworkUrl100, 1000);
    if (itCover) return itCover;
  } catch {
    // No cover is a valid answer.
  }

  return null;
}

/**
 * Fill in `coverUrl` for the entries that don't have one, in place.
 *
 * Bounded and batched on purpose. An unbounded pass over a 300-track playlist
 * would fire 300 provider lookups inside one request; a fully serial pass would
 * take minutes. `limit` caps the work and `concurrency` keeps the provider's
 * rate limit intact — the searches are cached, so a re-import or a second
 * playlist sharing tracks costs nothing.
 *
 * Anything past `limit` keeps whatever it arrived with (usually nothing), and
 * the UI shows a placeholder rather than someone else's artwork.
 */
export async function fillMissingCovers<T extends { title: string; artist: string; coverUrl?: string | null }>(
  tracks: T[],
  { limit = 120, concurrency = 6 }: { limit?: number; concurrency?: number } = {},
): Promise<{ filled: number; skipped: number }> {
  const needy: T[] = [];
  let skipped = 0;

  for (const track of tracks) {
    if (track.coverUrl || !track.title) continue;
    if (needy.length >= limit) {
      skipped += 1;
      continue;
    }
    needy.push(track);
  }

  let filled = 0;

  for (let i = 0; i < needy.length; i += concurrency) {
    const batch = needy.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (track) => {
        const cover = await findTrackCover(track.title, track.artist);
        if (cover) {
          track.coverUrl = cover;
          filled += 1;
        }
      }),
    );
  }

  return { filled, skipped };
}

/** Fallback identification when Deezer is down or has no match. */
export async function searchItunesTrack(
  title: string,
  artist: string,
): Promise<ItunesTrack | null> {
  const term = `${artist} ${title}`.replace(/['"]/g, '').trim();
  const key = cacheKey('ext', 'it', 'track', term.toLowerCase());

  return cachedWithStale(
    key,
    TTL.EXT_TRACK_SEARCH,
    async () => {
      const data = await fetchItunes<{ results: ItunesTrack[] }>(
        `/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5`,
        'search.track',
      );
      if (!data?.results?.length) return null;

      const normTitle = title.toLowerCase().replace(/[^\w]/g, '');
      return (
        data.results.find((t) =>
          t.trackName?.toLowerCase().replace(/[^\w]/g, '').includes(normTitle),
        ) ?? data.results[0]
      );
    },
    { label: 'itunes.track' },
  );
}

/**
 * Multi-result iTunes search, shaped to look like a Deezer search response.
 *
 * This exists so the search route can fall back without branching on which
 * provider answered. The shape is a faithful subset: `preview` and
 * `contributors` are genuinely unavailable from iTunes, and the album/artist
 * ids are iTunes ids rather than Deezer ones — so results are marked with
 * id 0 where a Deezer id would otherwise be assumed downstream, which keeps
 * them out of any code path that would try to treat them as Deezer keys.
 */
export async function searchTracksITunes(
  term: string,
  limit: number,
): Promise<DeezerTrack[]> {
  const data = await fetchItunes<{ results: ItunesTrack[] }>(
    `/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`,
    'search.tracks',
  );
  if (!data?.results?.length) return [];

  return data.results.map((it) => ({
    id: 0,
    title: it.trackName,
    duration: it.trackTimeMillis ? Math.round(it.trackTimeMillis / 1000) : 0,
    preview: '',
    artist: { id: 0, name: it.artistName },
    album: {
      id: 0,
      title: it.collectionName,
      cover_medium: itunesArtwork(it.artworkUrl100, 250) ?? '',
      cover_big: itunesArtwork(it.artworkUrl100, 1000),
      release_date: it.releaseDate,
    },
    contributors: [],
  })) as unknown as DeezerTrack[];
}

/**
 * Fetch one track by its Deezer id.
 *
 * Distinct from `searchDeezerTrack`, which guesses from a title/artist pair.
 * When a `deezer-<id>` link is already in hand — every track link a browse
 * surface produces — this resolves it exactly, with no chance of matching the
 * wrong recording. Cached like its album/artist siblings: a track's identity
 * doesn't change.
 */
export async function getDeezerTrack(trackId: number): Promise<DeezerTrack | null> {
  if (!Number.isFinite(trackId) || trackId <= 0) return null;
  const track = await cachedWithStale(
    cacheKey('ext', 'dz', 'track', trackId),
    TTL.EXT_ALBUM,
    () => fetchDeezer<DeezerTrack & { error?: unknown }>(`/track/${trackId}`, 'track'),
    { label: 'deezer.track' },
  );
  // A deleted or region-blocked track answers 200 with an `error` body rather
  // than a 4xx, so the HTTP layer sees success — same shape the playlist
  // resolver already guards against.
  if (!track || track.error || !track.title) return null;
  return track;
}

export async function getDeezerAlbum(albumId: number): Promise<DeezerAlbum | null> {
  return cachedWithStale(
    cacheKey('ext', 'dz', 'album', albumId),
    TTL.EXT_ALBUM,
    () => fetchDeezer<DeezerAlbum>(`/album/${albumId}`, 'album'),
    { label: 'deezer.album' },
  );
}

export async function getDeezerArtist(artistId: number): Promise<DeezerArtist | null> {
  return cachedWithStale(
    cacheKey('ext', 'dz', 'artist', artistId),
    TTL.EXT_ARTIST,
    () => fetchDeezer<DeezerArtist>(`/artist/${artistId}`, 'artist'),
    { label: 'deezer.artist' },
  );
}

export async function searchDeezerArtist(name: string): Promise<DeezerArtist | null> {
  return cachedWithStale(
    cacheKey('ext', 'dz', 'artistsearch', name.toLowerCase().trim()),
    TTL.EXT_ARTIST,
    async () => {
      const data = await fetchDeezer<{ data: DeezerArtist[] }>(
        `/search/artist?q=${encodeURIComponent(name)}&limit=3`,
        'search.artist',
      );
      if (!data?.data?.length) return null;

      const normalised = name.toLowerCase().replace(/[^\w]/g, '');
      const best = data.data.find((a) => {
        const aName = a.name.toLowerCase().replace(/[^\w]/g, '');
        return aName === normalised || aName.includes(normalised) || normalised.includes(aName);
      });

      return best || data.data[0];
    },
    { label: 'deezer.artistSearch' },
  );
}

export async function enrichTrackMetadata(
  title: string,
  artistName: string,
): Promise<EnrichedMetadata> {
  const result: EnrichedMetadata = {};
  const normalisedTitle = title.toLowerCase().replace(/[^\w]/g, '');

  const deezerTrack = await searchDeezerTrack(title, artistName);

  // Fallback identification. Only consulted when Deezer produced nothing —
  // either it has no match or its breaker is open — so the common path still
  // costs exactly one provider call.
  if (!deezerTrack) {
    const it = await searchItunesTrack(title, artistName);
    if (it) {
      const releaseYear = it.releaseDate ? parseInt(it.releaseDate.substring(0, 4)) : undefined;
      result.track = { deezerId: 0, previewUrl: undefined };
      result.artist = { deezerId: 0, name: it.artistName };
      result.album = {
        deezerId: 0,
        title: it.collectionName,
        coverUrl: itunesArtwork(it.artworkUrl100),
        releaseDate: it.releaseDate,
        releaseYear: Number.isNaN(releaseYear as number) ? undefined : releaseYear,
        genre: it.primaryGenreName,
        copyright: it.copyright,
      };
    }
  }

  if (deezerTrack) {
    result.track = {
      deezerId: deezerTrack.id,
      isrc: deezerTrack.isrc,
      previewUrl: deezerTrack.preview,
    };

    if (deezerTrack.contributors?.length) {
      result.track.contributors = deezerTrack.contributors.map((c) => ({
        name: c.name,
        role: c.role,
        imageUrl: c.picture_medium,
      }));
    }

    // Deezer artist + album: fetch concurrently instead of sequentially.
    const [artistData, albumData] = await Promise.all([
      getDeezerArtist(deezerTrack.artist.id),
      deezerTrack.album?.id ? getDeezerAlbum(deezerTrack.album.id) : Promise.resolve(null),
    ]);

    if (artistData) {
      result.artist = {
        deezerId: artistData.id,
        name: artistData.name,
        imageUrl: artistData.picture_big || artistData.picture_medium,
      };
    }

    if (albumData) {
      const releaseYear = albumData.release_date
        ? parseInt(albumData.release_date.substring(0, 4))
        : undefined;
      result.album = {
        deezerId: albumData.id,
        title: albumData.title,
        coverUrl: albumData.cover_big || albumData.cover_medium,
        releaseDate: albumData.release_date,
        releaseYear: isNaN(releaseYear as number) ? undefined : releaseYear,
        copyright: albumData.copyright,
        trackList: albumData.tracks?.data?.map((t) => ({
          title: t.title,
          position: t.track_position,
          duration: t.duration,
          artistId: t.artist.id,
          artistName: t.artist.name,
        })),
      };
    }
  }

  // Artist fallback: if the Deezer track didn't resolve (or didn't carry the
  // artist id), search for the artist batch.
  if (!result.artist) {
    const artistSearch = await searchDeezerArtist(artistName);
    if (artistSearch) {
      result.artist = {
        deezerId: artistSearch.id,
        name: artistSearch.name,
        imageUrl: artistSearch.picture_big || artistSearch.picture_medium,
      };
    }
  }

  return result;
}

export async function enrichAlbumTracks(
  albumId: number,
): Promise<{ title: string; artist: string; duration: number; position: number }[]> {
  const album = await getDeezerAlbum(albumId);
  if (!album?.tracks?.data) return [];

  return album.tracks.data.map((t) => ({
    title: t.title,
    artist: t.artist.name,
    duration: t.duration,
    position: t.track_position,
  }));
}

/**
 * Enrich a track from MusicBrainz, after the response has been sent.
 *
 * All three call sites invoked the old function without awaiting it, with a
 * comment saying "in the background". On a serverless platform there is no
 * background: the instance is frozen the moment the response is flushed, so the
 * pending `fetch` and every `UPDATE` behind it were abandoned mid-flight — the
 * work usually never happened, and when it did it was luck. Silent, because the
 * function catches its own errors, so nothing ever pointed at it.
 *
 * The pacer added in this file makes the old shape indefensible rather than just
 * wrong: enrichment now *deliberately* waits between requests, and un-awaited
 * waiting is a guaranteed loss. `after()` is Next's supported answer — it holds
 * the invocation open (via `waitUntil`) and shares the route's `maxDuration`.
 *
 * Still fire-and-forget from the caller's point of view, so no call site
 * changes. `after` throws outside a request scope, which is where a seed script
 * or a test would call this from; that case runs inline instead.
 */
export function enrichMusicBrainzAndSave(
  trackId: string,
  title: string,
  artistName: string,
  artistId: string,
): void {
  const run = () => runMusicBrainzEnrichment(trackId, title, artistName, artistId);

  try {
    after(run);
  } catch {
    void run();
  }
}

async function runMusicBrainzEnrichment(
  trackId: string,
  title: string,
  artistName: string,
  artistId: string
): Promise<void> {
  const normalisedTitle = title.toLowerCase().replace(/[^\w]/g, '');

  try {
    const searchQuery = encodeURIComponent(`recording:"${title.replace(/[^\w\s]/g, '')}" AND artist:"${artistName.replace(/[^\w\s]/g, '')}"`);
    const mbSearch = await fetchMusicBrainz<{ recordings: MusicBrainzRecording[] }>(
      `/recording?query=${searchQuery}&limit=5&fmt=json`,
      'search.recording',
    );

    if (mbSearch?.recordings?.length) {
      const normTitle = normalisedTitle;
      const normArtist = artistName.toLowerCase().replace(/[^\w]/g, '');

      const recording =
        mbSearch.recordings.find((r) => {
          const rTitle = r.title.toLowerCase().replace(/[^\w]/g, '');
          const rArtist = r['artist-credit']?.[0]?.artist?.name?.toLowerCase().replace(/[^\w]/g, '') || '';
          return rTitle.includes(normTitle) || normTitle.includes(rTitle) || rArtist.includes(normArtist);
        }) ?? mbSearch.recordings[0];

      // 1. Save ISRC to Track if present
      if (recording.isrcs?.length) {
        await execute(
          `UPDATE "Track" SET isrc = COALESCE(isrc, $1) WHERE id = $2`,
          [recording.isrcs[0], trackId]
        );
      }

      // 2. Save Genres to Artist if present
      if (recording.tags?.length) {
        const genres = recording.tags
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map((t) => t.name);
        await execute(
          `UPDATE "Artist" SET "genres" = $1 WHERE id = $2`,
          [genres, artistId]
        );
      }

      // 3. Fetch details
      const mbDetail = await cachedWithStale(
        cacheKey('ext', 'mb', 'recording', recording.id),
        TTL.EXT_CREDITS,
        () =>
          fetchMusicBrainz<MusicBrainzRecording>(
            `/recording/${recording.id}?inc=artist-rels+work-rels+artist-credits&fmt=json`,
            'recording.detail',
          ),
        { label: 'mb.recording' },
      );

      if (mbDetail) {
        const credits: { name: string; role: string }[] = [];
        const samples: { trackTitle: string; artistName: string; type: string }[] = [];

        if (mbDetail.relations?.length) {
          for (const rel of mbDetail.relations) {
            if (!rel.artist) continue;
            const relType = rel.type?.toLowerCase();
            if (relType === 'producer') credits.push({ name: rel.artist.name, role: 'Producer' });
            else if (relType === 'mix' || relType === 'mix-DJ') credits.push({ name: rel.artist.name, role: 'Mixer' });
            else if (relType === 'engineer' || relType === 'recording') credits.push({ name: rel.artist.name, role: 'Engineer' });
            else if (relType === 'instrument') {
              const instrument = (rel as any).attributes?.[0] || 'Instrumentalist';
              credits.push({ name: rel.artist.name, role: instrument });
            } else if (relType === 'vocal') {
              const vocalType = (rel as any).attributes?.[0] || 'Vocals';
              credits.push({ name: rel.artist.name, role: vocalType });
            } else if (relType === 'sampled by' || relType === 'samples') {
              samples.push({
                trackTitle: rel.target || 'Unknown',
                artistName: rel.artist?.name || 'Unknown',
                type: relType === 'samples' ? 'samples' : 'sampled',
              });
            }
          }
        }

        // Work relations
        const workRels = mbDetail.relations?.filter(
          (r: any) => r['target-type'] === 'work' || r.work
        );

        if (workRels?.length) {
          const workDetails = await Promise.allSettled(
            workRels.map((wrel: any) => {
              const workId = wrel.work?.id;
              if (!workId) return Promise.resolve(null);
              return cachedWithStale(
                cacheKey('ext', 'mb', 'work', workId),
                TTL.EXT_CREDITS,
                () =>
                  fetchMusicBrainz<{ relations?: any[] }>(
                    `/work/${workId}?inc=artist-rels&fmt=json`,
                    'work.detail',
                  ),
                { label: 'mb.work' },
              );
            })
          );

          for (const wd of workDetails) {
            if (wd.status !== "fulfilled" || !wd.value?.relations) continue;
            for (const wr of wd.value.relations) {
              if (!wr.artist) continue;
              const wrType = wr.type?.toLowerCase();
              if (wrType === 'writer' || wrType === 'lyricist' || wrType === 'composer') {
                const role =
                  wrType === 'lyricist' ? 'Lyricist' :
                  wrType === 'composer' ? 'Composer' :
                  'Songwriter';
                if (!credits.some((c) => c.name === wr.artist.name && c.role === role)) {
                  credits.push({ name: wr.artist.name, role });
                }
              }
            }
          }
        }

        // Save credits
        if (credits.length > 0) {
          await execute(
            `INSERT INTO "TrackCredit" (id, "trackId", name, role, "createdAt")
             SELECT gen_random_uuid()::text, $1, n, r, NOW()
               FROM UNNEST($2::text[], $3::text[]) AS t(n, r)
              WHERE NOT EXISTS (
                SELECT 1 FROM "TrackCredit" c
                 WHERE c."trackId" = $1 AND c.name = t.n AND c.role = t.r
              )`,
            [trackId, credits.map((c) => c.name), credits.map((c) => c.role)]
          );
        }

        // Save samples
        if (samples.length > 0) {
          const sampleTitles = samples.map((s) => s.trackTitle);
          const matches = await query<{ id: string; title: string }>(
            `SELECT DISTINCT ON (lower(title)) id, title
               FROM "Track"
              WHERE lower(title) = ANY(SELECT lower(x) FROM UNNEST($1::text[]) AS x)`,
            [sampleTitles]
          ).catch(() => [] as { id: string; title: string }[]);

          const idByTitle = new Map(matches.map((m) => [m.title.toLowerCase(), m.id]));
          const resolved = samples
            .map((s) => ({
              sampledId: idByTitle.get(s.trackTitle.toLowerCase()),
              type: s.type === "samples" ? "samples" : "sampled",
            }))
            .filter((s): s is { sampledId: string; type: string } =>
              !!s.sampledId && s.sampledId !== trackId
            );

          if (resolved.length > 0) {
            await execute(
              `INSERT INTO "SampledTrack" (id, "trackId", "sampledTrackId", "sampleType", "createdAt")
               SELECT gen_random_uuid()::text, $1, s, ty, NOW()
                 FROM UNNEST($2::text[], $3::text[]) AS t(s, ty)
               ON CONFLICT DO NOTHING`,
              [trackId, resolved.map((r) => r.sampledId), resolved.map((r) => r.type)]
            );
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Background MusicBrainz Enrichment Failed] for track ${trackId}:`, err);
  }
}
