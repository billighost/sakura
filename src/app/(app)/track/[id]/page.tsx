import { notFound } from "next/navigation";
import { queryOne, query } from "@/lib/sql";
import Link from "next/link";
import { PlayButton } from "./PlayButton";

interface TrackDetail {
  id: string;
  title: string;
  duration: number;
  audioUrl: string;
  coverUrl?: string;
  previewUrl?: string;
  isrc?: string;
  createdAt: string;
  artist: { id: string; name: string; imageUrl?: string };
  album?: { id: string; title: string; coverUrl?: string };
  otherArtists: { id: string; name: string; role: string }[];
}

interface Credit {
  id: string;
  name: string;
  role: string;
}

interface Sample {
  sampleType: string;
  trackId?: string;
  trackTitle: string;
  artistName: string;
}

async function getTrack(id: string): Promise<TrackDetail | null> {
  const track = await queryOne<{ 
    id: string;
    title: string;
    duration: number;
    audioUrl: string;
    coverUrl?: string;
    previewUrl?: string;
    isrc?: string;
    createdAt: string;
    artistId: string;
    artistName: string;
    artistImageUrl?: string;
    albumId?: string;
    albumTitle?: string;
    albumCoverUrl?: string;
  }>(
    `SELECT t.id, t.title, t.duration, t."audioUrl", t."coverUrl", t."previewUrl", t.isrc, t."createdAt",
            a.id as "artistId", a.name as "artistName", a."imageUrl" as "artistImageUrl",
            al.id as "albumId", al.title as "albumTitle", al."coverUrl" as "albumCoverUrl"
     FROM "Track" t
     JOIN "Artist" a ON t."artistId" = a.id
     LEFT JOIN "Album" al ON t."albumId" = al.id
     WHERE t.id = $1`,
    [id]
  );

  if (!track) return null;

  const otherArtists = await query<{ id: string; name: string; role: string }>(
    `SELECT a.id, a.name, ta.role
     FROM "TrackArtist" ta
     JOIN "Artist" a ON ta."artistId" = a.id
     WHERE ta."trackId" = $1 AND a.id != $2
     ORDER BY ta.position`,
    [id, track.artistId]
  );

  return {
    id: track.id,
    title: track.title,
    duration: track.duration,
    audioUrl: track.audioUrl,
    coverUrl: track.coverUrl,
    previewUrl: track.previewUrl,
    isrc: track.isrc,
    createdAt: track.createdAt,
    artist: { id: track.artistId, name: track.artistName, imageUrl: track.artistImageUrl },
    album: track.albumId ? { id: track.albumId, title: track.albumTitle!, coverUrl: track.albumCoverUrl } : undefined,
    otherArtists,
  };
}

async function getTrackCredits(id: string): Promise<{ credits: Credit[]; samples: Sample[]; sampledBy: Sample[] }> {
  try {
    const [credits, samples, sampledBy] = await Promise.all([
      query<Credit>(
        `SELECT id, name, role FROM "TrackCredit" WHERE "trackId" = $1 ORDER BY role, name`,
        [id]
      ),
      query<Sample>(
        `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
         FROM "SampledTrack" st
         JOIN "Track" t ON st."sampledTrackId" = t.id
         LEFT JOIN "Artist" a ON t."artistId" = a.id
         WHERE st."trackId" = $1`,
        [id]
      ),
      query<Sample>(
        `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
         FROM "SampledTrack" st
         JOIN "Track" t ON st."trackId" = t.id
         LEFT JOIN "Artist" a ON t."artistId" = a.id
         WHERE st."sampledTrackId" = $1`,
        [id]
      ),
    ]);

    return { credits, samples, sampledBy };
  } catch {
    return { credits: [], samples: [], sampledBy: [] };
  }
}

export default async function TrackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [track, { credits, samples, sampledBy }] = await Promise.all([
    getTrack(id),
    getTrackCredits(id),
  ]);

  if (!track) notFound();

  const coverUrl = track.album?.coverUrl || track.coverUrl;
  const duration = track.duration ? `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}` : "0:00";

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="max-w-4xl mx-auto px-4 pb-32">
        <div className="flex items-center gap-3 pt-4 pb-6">
          <button onClick={() => window.history.back()} className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Track Details</h1>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 mb-8">
          <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg overflow-hidden bg-[var(--bg-secondary)] flex-shrink-0 mx-auto sm:mx-0 shadow-lg">
            {coverUrl ? (
              <img src={coverUrl} alt={track.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--text-tertiary)] text-4xl">
                ♪
              </div>
            )}
          </div>

          <div className="flex flex-col justify-end text-center sm:text-left">
            <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Track</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] mb-2 line-clamp-2">{track.title}</h1>
            <div className="flex items-center gap-2 justify-center sm:justify-start text-sm text-[var(--text-secondary)]">
              <Link href={`/artist/${track.artist.id}`} className="hover:text-[var(--accent)] transition-colors font-medium">
                {track.artist.name}
              </Link>
              {track.otherArtists.length > 0 && track.otherArtists.map((a) => (
                <span key={a.id}>
                  {a.role === "featured" ? "ft. " : a.role === "main" ? "& " : ""}
                  <Link href={`/artist/${a.id}`} className="hover:text-[var(--accent)] transition-colors">
                    {a.name}
                  </Link>
                </span>
              ))}
              {track.album && (
                <>
                  <span className="text-[var(--text-tertiary)]">·</span>
                  <Link href={`/album/${track.album.id}`} className="hover:text-[var(--accent)] transition-colors">
                    {track.album.title}
                  </Link>
                </>
              )}
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">{duration}</p>

            <div className="mt-4">
              <PlayButton trackId={track.id} audioUrl={track.audioUrl} title={track.title} artistName={track.artist.name} coverUrl={coverUrl} duration={track.duration} />
            </div>
          </div>
        </div>

        {(credits.length > 0 || samples.length > 0 || sampledBy.length > 0) && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Song DNA</h2>

            {credits.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Credits</h3>
                <div className="flex flex-wrap gap-2">
                  {credits.map((c) => (
                    <div key={c.id} className="px-3 py-1.5 bg-[var(--bg-secondary)] rounded-full text-sm">
                      <span className="text-[var(--text-primary)]">{c.name}</span>
                      <span className="text-[var(--text-tertiary)] ml-1">· {c.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {samples.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Samples</h3>
                <div className="space-y-2">
                  {samples.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--bg-secondary)]">
                      <div className="w-8 h-8 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">♪</div>
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{s.trackTitle}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">{s.artistName} · {s.sampleType}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sampledBy.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">Sampled By</h3>
                <div className="space-y-2">
                  {sampledBy.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--bg-secondary)]">
                      <div className="w-8 h-8 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">♪</div>
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{s.trackTitle}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">{s.artistName} · {s.sampleType}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {track.isrc && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2">Track Info</h2>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">ISRC</span>
                <span className="text-[var(--text-primary)] font-mono">{track.isrc}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Added</span>
                <span className="text-[var(--text-primary)]">{new Date(track.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
