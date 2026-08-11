import { notFound } from "next/navigation";
import { queryOne, query } from "@/lib/sql";
import { getDeezerTrack } from "@/lib/metadata";
import Link from "next/link";
import { PlayButton } from "./PlayButton";
import { BackButton } from "@/components/BackButton";
import { MusicNoteIcon } from "@/components/Icons";
import styles from "./page.module.css";

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

/**
 * Build a track detail for a `deezer-<id>` link that has no local row yet.
 *
 * Search, charts, artist pages and album pages all hand the UI virtual ids
 * (`src/lib/catalog.ts` `toVirtual`), but this page only ever looked in
 * `Track`. A track is written to the database at download time, so every link
 * from a browse surface pointed at a row that did not exist yet and the page
 * 404'd — the reported bug. Resolving from Deezer here makes the page work
 * before the download, and the local row still wins once it exists.
 */
async function resolveVirtualTrack(id: string): Promise<TrackDetail | null> {
  const match = /^deezer-(\d+)$/.exec(id);
  if (!match) return null;

  const dt = await getDeezerTrack(Number(match[1]));
  if (!dt) return null;

  return {
    id,
    title: dt.title,
    duration: dt.duration ?? 0,
    // No stored audio yet: PlayButton resolves playback through the normal
    // download path, the same way a search result row does.
    audioUrl: "",
    coverUrl: dt.album?.cover_big || dt.album?.cover_medium || undefined,
    previewUrl: dt.preview || undefined,
    isrc: dt.isrc || undefined,
    createdAt: new Date().toISOString(),
    artist: {
      id: dt.artist?.id ? `deezer-${dt.artist.id}` : id,
      name: dt.artist?.name ?? "Unknown Artist",
      imageUrl: dt.artist?.picture_medium || undefined,
    },
    album: dt.album?.id
      ? {
          id: `deezer-${dt.album.id}`,
          title: dt.album.title,
          coverUrl: dt.album.cover_big || dt.album.cover_medium || undefined,
        }
      : undefined,
    otherArtists: [],
  };
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

  if (!track) return resolveVirtualTrack(id);

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

function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
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
  const addedDate = new Date(track.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className={styles.page}>
      {/* Deep-linkable from a share, so back needs somewhere to go when there
          is no history to pop. */}
      <BackButton className={styles.backBtn} fallback="/home" />

      <div className={styles.heroSection}>
        {coverUrl ? (
          <img className={styles.heroBleed} src={coverUrl} alt="" aria-hidden="true" />
        ) : (
          <div className={styles.heroBleedFallback} />
        )}
        <div className={styles.hero}>
          <div className={styles.coverWrap}>
            {coverUrl ? (
              <img src={coverUrl} alt={track.title} className={styles.coverImg} />
            ) : (
              <span className={styles.coverFallback} aria-hidden="true">
                <MusicNoteIcon size={40} />
              </span>
            )}
          </div>

          <div className={styles.heroInfo}>
            <div className={styles.eyebrow}>Track</div>
            <h1 className={styles.title}>{track.title}</h1>
            <div className={styles.byline}>
              <Link href={`/artist/${track.artist.id}`} className={styles.artistLink}>
                {track.artist.name}
              </Link>
              {track.otherArtists.length > 0 && track.otherArtists.map((a) => (
                <span key={a.id}>
                  {a.role === "featured" ? "ft. " : a.role === "main" ? "& " : ""}
                  <Link href={`/artist/${a.id}`} className={styles.artistLink}>
                    {a.name}
                  </Link>
                </span>
              ))}
              {track.album && (
                <>
                  <span className={styles.dot}>·</span>
                  <Link href={`/album/${track.album.id}`} className={styles.artistLink}>
                    {track.album.title}
                  </Link>
                </>
              )}
            </div>
            <div className={styles.duration}>{duration}</div>

            <div className={styles.playRow}>
              <PlayButton trackId={track.id} audioUrl={track.audioUrl} title={track.title} artistName={track.artist.name} coverUrl={coverUrl} duration={track.duration} />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.container}>
        {(credits.length > 0 || samples.length > 0 || sampledBy.length > 0) && (
          <div className={`${styles.section} anim-fade-in`}>
            <div className={styles.sectionTitle}>Song DNA</div>

            {credits.length > 0 && (
              <div className={styles.subSection}>
                <div className={styles.subTitle}>Credits</div>
                <div className={styles.creditChips}>
                  {credits.map((c) => (
                    <div key={c.id} className={styles.creditChip}>
                      <span className={styles.creditName}>{c.name}</span>
                      <span className={styles.creditRole}>· {c.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {samples.length > 0 && (
              <div className={styles.subSection}>
                <div className={styles.subTitle}>Samples</div>
                {samples.map((s, i) => (
                  <div key={i} className={styles.sampleRow}>
                    <div className={styles.sampleIcon}><NoteIcon /></div>
                    <div>
                      <p className={styles.sampleTitle}>{s.trackTitle}</p>
                      <p className={styles.sampleMeta}>{s.artistName} · {s.sampleType}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sampledBy.length > 0 && (
              <div className={styles.subSection}>
                <div className={styles.subTitle}>Sampled by</div>
                {sampledBy.map((s, i) => (
                  <div key={i} className={styles.sampleRow}>
                    <div className={styles.sampleIcon}><NoteIcon /></div>
                    <div>
                      <p className={styles.sampleTitle}>{s.trackTitle}</p>
                      <p className={styles.sampleMeta}>{s.artistName} · {s.sampleType}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {track.isrc && (
          <div className={`${styles.section} anim-fade-in`}>
            <div className={styles.sectionTitle}>Track info</div>
            <div className={styles.infoCard}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>ISRC</span>
                <span className={styles.infoValue}>{track.isrc}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Added</span>
                <span className={styles.infoValue} style={{ fontFamily: "inherit" }}>{addedDate}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
