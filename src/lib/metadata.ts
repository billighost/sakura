import { fetchJsonResilient } from './resilience';
import { cachedWithStale, cacheKey, TTL } from './cache';
import { execute, query } from './sql';

interface DeezerTrack {
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
const USER_AGENT = 'SakuraMusic/1.0 (https://github.com/sakura-music)';

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
 * MusicBrainz asks for ~1 request/second per client and enforces it. It is
 * also the slowest provider here by a wide margin, so it gets a longer
 * timeout, fewer retries, and a twitchier breaker than Deezer: when MB is
 * struggling the right move is to stop asking, not to try harder.
 */
const MB_TIMEOUT_MS = 8000;

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

async function fetchMusicBrainz<T>(endpoint: string, op: string): Promise<T | null> {
  return fetchJsonResilient<T>(`${MUSICBRAINZ_BASE}${endpoint}`, {
    provider: 'musicbrainz',
    op,
    headers: { 'User-Agent': USER_AGENT },
    revalidate: 86400,
    timeoutMs: MB_TIMEOUT_MS,
    attempts: 2,
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

export async function enrichMusicBrainzAndSave(
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
