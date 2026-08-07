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

async function fetchJson<T>(url: string, revalidate = 3600): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Timeout, network failure, or malformed JSON — all equally "no data".
    return null;
  }
}

async function fetchDeezer<T>(endpoint: string): Promise<T | null> {
  return fetchJson<T>(`${DEEZER_BASE}${endpoint}`);
}

async function fetchMusicBrainz<T>(endpoint: string): Promise<T | null> {
  return fetchJson<T>(`${MUSICBRAINZ_BASE}${endpoint}`);
}

export async function searchDeezerTrack(
  title: string,
  artist: string,
): Promise<DeezerTrack | null> {
  const query = `${artist} ${title}`.replace(/['"]/g, '').replace(/[^\w\s]/g, ' ');
  const data = await fetchDeezer<{ data: DeezerTrack[] }>(
    `/search?q=${encodeURIComponent(query)}&limit=5`
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
}

export async function getDeezerAlbum(albumId: number): Promise<DeezerAlbum | null> {
  return fetchDeezer<DeezerAlbum>(`/album/${albumId}`);
}

export async function getDeezerArtist(artistId: number): Promise<DeezerArtist | null> {
  return fetchDeezer<DeezerArtist>(`/artist/${artistId}`);
}

export async function searchDeezerArtist(name: string): Promise<DeezerArtist | null> {
  const data = await fetchDeezer<{ data: DeezerArtist[] }>(
    `/search/artist?q=${encodeURIComponent(name)}&limit=3`
  );
  if (!data?.data?.length) return null;

  const normalised = name.toLowerCase().replace(/[^\w]/g, '');
  const best = data.data.find((a) => {
    const aName = a.name.toLowerCase().replace(/[^\w]/g, '');
    return aName === normalised || aName.includes(normalised) || normalised.includes(aName);
  });

  return best || data.data[0];
}

export async function enrichTrackMetadata(
  title: string,
  artistName: string,
): Promise<EnrichedMetadata> {
  const result: EnrichedMetadata = {};
  const normalisedTitle = title.toLowerCase().replace(/[^\w]/g, '');

  const deezerTrack = await searchDeezerTrack(title, artistName);

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

  // MusicBrainz: run in parallel with Deezer artist/album when we already
  // have the track data. The result feeds credits, genres and ISRC — none of
  // them block creating the track row.
  try {
    const searchQuery = encodeURIComponent(`recording:"${title}" AND artist:"${artistName}"`);
    const mbSearch = await fetchMusicBrainz<{ recordings: MusicBrainzRecording[] }>(
      `/recording?query=${searchQuery}&limit=5&fmt=json`
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

      // ISRC
      if (recording.isrcs?.length && !result.track?.isrc) {
        if (!result.track) result.track = { deezerId: 0 };
        result.track.isrc = recording.isrcs[0];
      }

      // Genres
      if (recording.tags?.length && !result.artist?.genres) {
        const genres = recording.tags
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map((t) => t.name);
        if (!result.artist) result.artist = { deezerId: 0, name: artistName };
        result.artist.genres = genres;
      }

      // Full recording details with relations
      const mbDetail = await fetchMusicBrainz<MusicBrainzRecording>(
        `/recording/${recording.id}?inc=artist-rels+work-rels+artist-credits&fmt=json`
      );

      if (mbDetail) {
        const credits: { name: string; role: string }[] = [];
        const samples: { trackId?: string; trackTitle: string; artistName: string; type: string }[] = [];

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

        // Work relations: fetch in parallel, not serially in a loop.
        const workRels = mbDetail.relations?.filter(
          (r: any) => r['target-type'] === 'work' || r.work
        );

        if (workRels?.length) {
          const workDetails = await Promise.allSettled(
            workRels.map((wrel: any) => {
              const workId = wrel.work?.id;
              if (!workId) return Promise.resolve(null);
              return fetchMusicBrainz<{ relations?: any[] }>(
                `/work/${workId}?inc=artist-rels&fmt=json`
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

        if (credits.length > 0) result.credits = credits;
        if (samples.length > 0) result.samples = samples;
      }
    }
  } catch {
    // MusicBrainz is best-effort.
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
