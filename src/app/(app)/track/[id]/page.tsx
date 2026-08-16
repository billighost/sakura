import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { queryOne, query } from "@/lib/sql";
import { getDeezerTrack } from "@/lib/metadata";
import { TrackActions } from "./TrackActions";
import { BackButton } from "@/components/BackButton";
import { ArtworkTint } from "@/components/ArtworkTint";
import { MusicNoteIcon, MusicNotesIcon } from "@/components/Icons";
import Loading from "./loading";
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
    // No stored audio yet: TrackActions resolves playback through the normal
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

/**
 * One credit row per role rather than one per person.
 *
 * Most tracks with real credits have several writers and several producers, and
 * a row each turned the section into a wall of near-identical lines. Grouping
 * matches how CreditsSection renders the same data inside the player, so the two
 * places this information appears agree with each other.
 */
function groupCredits(credits: Credit[]): { role: string; names: string[] }[] {
  const byRole = new Map<string, string[]>();
  for (const c of credits) {
    if (!c.name) continue;
    const role = c.role || "Credit";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(c.name);
  }
  return Array.from(byRole, ([role, names]) => ({ role, names }));
}

/** A sample is a link when we have the track, plain text when we don't. */
function SampleRow({ sample }: { sample: Sample }) {
  const body = (
    <>
      <span className={styles.sampleGlyph} aria-hidden="true">
        <MusicNotesIcon size={15} />
      </span>
      <span className={styles.sampleText}>
        <span className={styles.sampleTitle}>{sample.trackTitle}</span>
        <span className={styles.sampleMeta}>
          {sample.artistName || "Unknown artist"} · {sample.sampleType}
        </span>
      </span>
    </>
  );

  if (!sample.trackId) {
    return <div className={styles.sampleRow}>{body}</div>;
  }

  return (
    <Link href={`/track/${sample.trackId}`} className={`${styles.sampleRow} ${styles.sampleLink} pressable`}>
      {body}
    </Link>
  );
}

async function TrackDetailView({ id }: { id: string }) {
  const [track, { credits, samples, sampledBy }] = await Promise.all([
    getTrack(id),
    getTrackCredits(id),
  ]);

  if (!track) notFound();

  const coverUrl = track.album?.coverUrl || track.coverUrl;
  const duration = track.duration
    ? `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`
    : null;
  const addedDate = new Date(track.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const groupedCredits = groupCredits(credits);
  const hasDna = groupedCredits.length > 0 || samples.length > 0 || sampledBy.length > 0;

  return (
    <div className={styles.page} data-page-scroll>
      {/* The tint has to be applied on the client, since it's read out of the
          artwork's pixels. Only this wrapper is a client component; everything
          inside stays server-rendered. */}
      <ArtworkTint src={coverUrl} className={styles.heroTint}>
        <header className={styles.hero}>
          <div className={styles.backRow}>
            {/* Deep-linkable from a share, so back needs somewhere to go when
                there is no history to pop. */}
            <BackButton fallback="/home" />
          </div>

          <div className={styles.cover}>
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className={styles.coverImg} />
            ) : (
              <span className={styles.coverFallback} aria-hidden="true">
                <MusicNoteIcon size={40} />
              </span>
            )}
          </div>

          <p className={styles.eyebrow}>Song</p>
          <h1 className={styles.title}>{track.title}</h1>

          <p className={styles.byline}>
            <Link href={`/artist/${track.artist.id}`} className={styles.link}>
              {track.artist.name}
            </Link>
            {track.otherArtists.map((a) => (
              <span key={a.id}>
                {a.role === "featured" ? " ft. " : a.role === "main" ? " & " : " "}
                <Link href={`/artist/${a.id}`} className={styles.link}>
                  {a.name}
                </Link>
              </span>
            ))}
          </p>

          <p className={styles.meta}>
            {track.album && (
              <>
                <Link href={`/album/${track.album.id}`} className={styles.link}>
                  {track.album.title}
                </Link>
                {duration && <span aria-hidden="true"> · </span>}
              </>
            )}
            {duration}
          </p>

          <TrackActions
            trackId={track.id}
            audioUrl={track.audioUrl}
            title={track.title}
            artistName={track.artist.name}
            album={track.album?.title}
            coverUrl={coverUrl}
            duration={track.duration}
          />
        </header>
      </ArtworkTint>

      <div className={styles.body}>
        {hasDna && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Song DNA</h2>

            {groupedCredits.length > 0 && (
              <dl className={styles.creditList}>
                {groupedCredits.map((g) => (
                  <div key={g.role} className={styles.creditRow}>
                    <dt className={styles.creditRole}>{g.role}</dt>
                    <dd className={styles.creditNames}>{g.names.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            )}

            {samples.length > 0 && (
              <div className={styles.subSection}>
                <h3 className={styles.subTitle}>Samples</h3>
                {samples.map((s, i) => (
                  <SampleRow key={`sample-${i}`} sample={s} />
                ))}
              </div>
            )}

            {sampledBy.length > 0 && (
              <div className={styles.subSection}>
                <h3 className={styles.subTitle}>Sampled in</h3>
                {sampledBy.map((s, i) => (
                  <SampleRow key={`sampled-${i}`} sample={s} />
                ))}
              </div>
            )}
          </section>
        )}

        {/*
          Was gated on `track.isrc`, which hid the added date for every track
          without one — most of them. The date is always known, so the section
          always has something to say.
        */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Details</h2>
          <dl className={styles.infoCard}>
            <div className={styles.infoRow}>
              <dt className={styles.infoLabel}>Added to Sakura</dt>
              <dd className={styles.infoValue}>{addedDate}</dd>
            </div>
            {duration && (
              <div className={styles.infoRow}>
                <dt className={styles.infoLabel}>Length</dt>
                <dd className={`${styles.infoValue} ${styles.mono}`}>{duration}</dd>
              </div>
            )}
            {track.isrc && (
              <div className={styles.infoRow}>
                {/* The recording's international ID. Expanded because "ISRC"
                    means nothing to anyone who hasn't worked in music. */}
                <dt className={styles.infoLabel}>Recording code</dt>
                <dd className={`${styles.infoValue} ${styles.mono}`}>{track.isrc}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}

export default async function TrackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense fallback={<Loading />}>
      <TrackDetailView id={id} />
    </Suspense>
  );
}
