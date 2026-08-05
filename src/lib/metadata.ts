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
    artist?: { name: string };
    direction?: string;
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

async function fetchDeezer<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`${DEEZER_BASE}${endpoint}`, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchMusicBrainz<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`${MUSICBRAINZ_BASE}${endpoint}`, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
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

    const artistData = await getDeezerArtist(deezerTrack.artist.id);
    if (artistData) {
      result.artist = {
        deezerId: artistData.id,
        name: artistData.name,
        imageUrl: artistData.picture_big || artistData.picture_medium,
      };
    }

    if (deezerTrack.album?.id) {
      const albumData = await getDeezerAlbum(deezerTrack.album.id);
      if (albumData) {
        let releaseYear: number | undefined;
        if (albumData.release_date) {
          const year = parseInt(albumData.release_date.substring(0, 4));
          if (!isNaN(year)) releaseYear = year;
        }

        result.album = {
          deezerId: albumData.id,
          title: albumData.title,
          coverUrl: albumData.cover_big || albumData.cover_medium,
          releaseDate: albumData.release_date,
          releaseYear,
          copyright: albumData.copyright,
        };

        if (albumData.tracks?.data) {
          result.album.trackList = albumData.tracks.data.map((t) => ({
            title: t.title,
            position: t.track_position,
            duration: t.duration,
            artistId: t.artist.id,
            artistName: t.artist.name,
          }));
        }
      }
    }
  }

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

  try {
    const mbData = await fetchMusicBrainz<{ recordings: MusicBrainzRecording[] }>(
      `/recording?query=${encodeURIComponent(`recording:"${title}" AND artist:"${artistName}"`)}&limit=3&fmt=json`
    );

    if (mbData?.recordings?.length) {
      const recording = mbData.recordings[0];

      if (recording.isrcs?.length && !result.track?.isrc) {
        if (!result.track) result.track = { deezerId: 0 };
        result.track.isrc = recording.isrcs[0];
      }

      if (recording.tags?.length && !result.artist?.genres) {
        const genres = recording.tags
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map((t) => t.name);
        if (!result.artist) {
          result.artist = { deezerId: 0, name: artistName };
        }
        result.artist.genres = genres;
      }

      if (recording.relations?.length) {
        const credits: { name: string; role: string }[] = [];
        const samples: { trackId?: string; trackTitle: string; artistName: string; type: string }[] = [];

        for (const rel of recording.relations) {
          if (rel.type === "producer" && rel.artist) {
            credits.push({ name: rel.artist.name, role: "producer" });
          } else if (rel.type === "written by" && rel.artist) {
            credits.push({ name: rel.artist.name, role: "songwriter" });
          } else if (rel.type === "sampled by" || rel.type === "samples") {
            const trackTitle = rel.target.split("/").pop() || rel.target;
            samples.push({
              trackTitle,
              artistName: rel.artist?.name || "Unknown",
              type: rel.type === "samples" ? "samples" : "sampled",
            });
          }
        }

        if (credits.length > 0) result.credits = credits;
        if (samples.length > 0) result.samples = samples;
      }
    }
  } catch {
    // MusicBrainz is optional, ignore errors
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
