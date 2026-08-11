"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { MediaCard } from "@/components/MediaCard";
import { Rail } from "@/components/Rail";
import {
  HeartIcon,
  DownloadedIcon,
  PlaylistIcon,
  PlayIcon,
  PauseIcon,
  ShuffleIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
  ChevronRightIcon,
} from "@/components/Icons";
import { usePlayer } from "@/components/PlayerContext";
import { haptic } from "@/lib/haptics";
import type { HomeData, HomeTrack } from "@/lib/homeData";
import styles from "./page.module.css";

/**
 * The home feed's interactive half.
 *
 * The page shell stays a server component (auth, data, the greeting) and this
 * renders everything the user can act on, because almost every card here now
 * starts playback rather than navigating to a page that has a play button on
 * it. Splitting at the data boundary keeps the server render streaming while
 * confining the client bundle to what genuinely needs interactivity.
 */

/** The player's Track shape, from the home feed's narrower one. */
function toQueue(tracks: HomeTrack[]) {
  return tracks
    .filter((t) => t.audioUrl)
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      coverUrl: t.coverUrl ?? undefined,
      audioUrl: t.audioUrl as string,
      duration: t.duration ?? 0,
    }));
}

export function HomeFeed({ data }: { data: HomeData }) {
  const { play, currentTrack, isPlaying, togglePlay } = usePlayer();

  const quickQueue = toQueue(data.quickPicks);
  const recentQueue = toQueue(data.recentlyPlayed);

  /* The lead mix: the one thing on this page that gets a large treatment. */
  const lead = data.madeForYou[0] ?? null;
  const restOfMixes = lead ? data.madeForYou.slice(1) : data.madeForYou;

  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  /**
   * A mix stores track ids, not tracks, so playing one costs a fetch. That
   * makes a real pending state mandatory — the gap between tap and sound is
   * long enough that a button which looks inert reads as broken.
   */
  const playLead = useCallback(
    async (shuffle: boolean) => {
      if (!lead || leadLoading) return;
      haptic("impact");
      setLeadLoading(true);
      setLeadError(null);

      try {
        const res = await fetch(`/api/mixes/${lead.id}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();

        const tracks = (json.tracks ?? [])
          .filter((t: { audioUrl?: string }) => t.audioUrl)
          .map((t: {
            id: string;
            title: string;
            duration: number;
            audioUrl: string;
            coverUrl?: string;
            artist?: { name?: string };
          }) => ({
            id: t.id,
            title: t.title,
            artist: t.artist?.name ?? "Unknown Artist",
            coverUrl: t.coverUrl,
            audioUrl: t.audioUrl,
            duration: t.duration ?? 0,
          }));

        if (tracks.length === 0) {
          setLeadError("Nothing in this mix can be played yet.");
          return;
        }

        const ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
        play(ordered[0], ordered);
      } catch {
        // An error the user can act on, rather than a button that just
        // stopped doing anything.
        setLeadError("Couldn't start this mix. Check your connection.");
      } finally {
        setLeadLoading(false);
      }
    },
    [lead, leadLoading, play]
  );

  return (
    <>
      {/* ── Shelves: the fixed places, always in the same spot ────────────── */}
      <nav className={styles.shelves} aria-label="Your collections">
        <Shelf href="/liked" label="Liked songs" icon={<HeartIcon size={18} filled />} tone="accent" />
        <Shelf
          href="/library/downloaded"
          label="Downloaded"
          icon={<DownloadedIcon size={18} />}
          tone="success"
        />
        {data.playlists.slice(0, 4).map((pl) => (
          <Shelf
            key={pl.id}
            href={`/playlist/${pl.id}`}
            label={pl.name}
            coverUrl={pl.coverUrl}
            icon={<PlaylistIcon size={18} />}
          />
        ))}
      </nav>

      {/* ── The lead ──────────────────────────────────────────────────────── */}
      {lead && (
        <section className={styles.lead}>
          <Link href={`/mix/${lead.id}`} className={`${styles.leadArt} pressable-lg`} aria-hidden="true" tabIndex={-1}>
            {lead.coverUrls?.length >= 4 ? (
              <div className={styles.leadMosaic}>
                {lead.coverUrls.slice(0, 4).map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt="" className={styles.leadMosaicCell} />
                ))}
              </div>
            ) : lead.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.coverUrl} alt="" className={styles.leadImage} />
            ) : (
              <div className={styles.leadFallback}>
                <SparklesIcon size={34} />
              </div>
            )}
          </Link>

          <div className={styles.leadBody}>
            <p className={styles.leadEyebrow}>
              {lead.kind === "daily" ? "Today's mix" : "Made for you"}
            </p>
            <h2 className={styles.leadTitle}>
              <Link href={`/mix/${lead.id}`} className={styles.leadLink}>
                {lead.label}
              </Link>
            </h2>
            {(lead.subtitle || lead.description) && (
              <p className={styles.leadDesc}>{lead.subtitle || lead.description}</p>
            )}

            <div className={styles.leadActions}>
              <button
                type="button"
                className={`${styles.leadPlay} pressable`}
                onClick={() => playLead(false)}
                disabled={leadLoading}
              >
                {leadLoading ? (
                  <span className={styles.leadSpinner} aria-hidden="true" />
                ) : (
                  <PlayIcon size={16} />
                )}
                {leadLoading ? "Starting…" : "Play"}
              </button>
              <button
                type="button"
                className={`${styles.leadShuffle} pressable`}
                onClick={() => playLead(true)}
                disabled={leadLoading}
                aria-label={`Shuffle ${lead.label}`}
              >
                <ShuffleIcon size={16} />
              </button>
            </div>

            {leadError && (
              <p className={styles.leadError} role="alert">
                {leadError}{" "}
                <button type="button" className={styles.retry} onClick={() => playLead(false)}>
                  Try again
                </button>
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Quick picks: two-up rows, playable in place ───────────────────── */}
      {data.quickPicks.length > 0 && (
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Quick picks</h2>
          </header>
          <div className={`${styles.picks} anim-stagger`}>
            {data.quickPicks.map((track, i) => (
              <PickRow
                key={track.id}
                track={track}
                queue={quickQueue}
                index={i}
                current={currentTrack}
                isPlaying={isPlaying}
                onPlay={play}
                onToggle={togglePlay}
              />
            ))}
          </div>
        </section>
      )}

      {restOfMixes.length > 0 && (
        <Rail title="Made for you">
          {restOfMixes.map((mix, i) => (
            <MediaCard
              key={mix.id}
              index={i}
              href={`/mix/${mix.id}`}
              title={mix.label}
              subtitle={mix.subtitle || mix.description}
              coverUrl={mix.coverUrl}
              coverUrls={mix.coverUrls}
              size="lg"
              badge={mix.trackCount ? `${mix.trackCount} songs` : undefined}
              fallbackIcon={<SparklesIcon size={26} />}
            />
          ))}
        </Rail>
      )}

      {data.recentlyPlayed.length > 0 && (
        <Rail title="Recently played">
          {data.recentlyPlayed.map((track, i) => (
            <MediaCard
              key={track.id}
              index={i}
              href={`/track/${track.id}`}
              title={track.title}
              subtitle={track.artist}
              coverUrl={track.coverUrl}
              track={track}
              queue={recentQueue}
            />
          ))}
        </Rail>
      )}

      {data.topArtists.length > 0 && (
        <Rail title="Your top artists">
          {data.topArtists.map((artist, i) => (
            <MediaCard
              key={artist.id}
              index={i}
              href={`/artist/${artist.id}`}
              title={artist.name}
              coverUrl={artist.avatarUrl}
              shape="round"
              fallbackIcon={<UserIcon size={24} />}
            />
          ))}
        </Rail>
      )}

      {data.systemPlaylists.length > 0 && (
        <Rail title="Charts" eyebrow="Updated daily">
          {data.systemPlaylists.map((pl, i) => (
            <MediaCard
              key={pl.id}
              index={i}
              href={`/playlist/system/${pl.systemId}`}
              title={pl.name}
              coverUrl={pl.coverUrl}
              fallbackIcon={<PlaylistIcon size={24} />}
            />
          ))}
        </Rail>
      )}
    </>
  );
}

/* ── Shelf ────────────────────────────────────────────────────────────────
 *
 * The compact two-column tiles at the top. These are destinations rather than
 * recommendations, so they hold a fixed position and never scroll — muscle
 * memory is worth more here than novelty. */

function Shelf({
  href,
  label,
  icon,
  coverUrl,
  tone,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  coverUrl?: string | null;
  tone?: "accent" | "success";
}) {
  return (
    <Link href={href} className={`${styles.shelf} pressable`}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className={styles.shelfArt} loading="lazy" />
      ) : (
        <span
          className={`${styles.shelfIcon} ${
            tone === "accent" ? styles.shelfAccent : tone === "success" ? styles.shelfSuccess : ""
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <span className={styles.shelfLabel}>{label}</span>
    </Link>
  );
}

/* ── Pick row ─────────────────────────────────────────────────────────────── */

function PickRow({
  track,
  queue,
  index,
  current,
  isPlaying,
  onPlay,
  onToggle,
}: {
  track: HomeTrack;
  queue: ReturnType<typeof toQueue>;
  index: number;
  current: { id: string; resolvedId?: string } | null;
  isPlaying: boolean;
  onPlay: (t: ReturnType<typeof toQueue>[number], q: ReturnType<typeof toQueue>) => void;
  onToggle: () => void;
}) {
  const isCurrent = Boolean(current && (current.resolvedId ?? current.id) === track.id);
  const active = isCurrent && isPlaying;

  const handle = () => {
    if (!track.audioUrl) return;
    if (isCurrent) {
      onToggle();
      haptic("selection");
      return;
    }
    haptic("impact");
    const self = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl ?? undefined,
      audioUrl: track.audioUrl,
      duration: track.duration ?? 0,
    };
    onPlay(self, queue.length ? queue : [self]);
  };

  return (
    <div
      className={`${styles.pick} ${isCurrent ? styles.pickActive : ""}`}
      style={{ "--i": Math.min(index, 12) } as React.CSSProperties}
    >
      <button
        type="button"
        className={`${styles.pickHit} pressable`}
        onClick={handle}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}
      >
        <span className={styles.pickArt}>
          {track.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.coverUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.pickFallback} aria-hidden="true">
              <PlaylistIcon size={16} />
            </span>
          )}
          <span className={styles.pickOverlay} aria-hidden="true">
            {active ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
          </span>
        </span>

        <span className={styles.pickMeta}>
          <span className={styles.pickTitle}>{track.title}</span>
          <span className={styles.pickArtist}>{track.artist}</span>
        </span>
      </button>

      {/* A separate, smaller target for "tell me about this" — the row itself
          belongs to play, which is what people want 90% of the time. */}
      <Link
        href={`/track/${track.id}`}
        className={`${styles.pickMore} tapTarget`}
        aria-label={`Open ${track.title}`}
      >
        <ChevronRightIcon size={16} />
      </Link>
    </div>
  );
}

/* ── First run ────────────────────────────────────────────────────────────── */

/**
 * What a brand-new account sees.
 *
 * The previous empty state said "Nothing playing yet" and offered one link to
 * search, which puts the entire burden of starting on someone who has just
 * arrived and has no idea what's in here. This offers three concrete openings
 * and explains what the app will do with them, because the first session is
 * where taste data comes from and an empty home page collects none.
 */
export function FirstRun({ hasCharts }: { hasCharts: boolean }) {
  return (
    <div className={styles.firstRun}>
      <div className={styles.firstRunGlyph} aria-hidden="true">
        <SparklesIcon size={38} />
      </div>
      <h2 className={styles.firstRunTitle}>Your home fills itself in</h2>
      <p className={styles.firstRunBody}>
        Play a few songs and this page starts building mixes around what you
        actually listen to. Here&apos;s somewhere to start.
      </p>

      <div className={styles.firstRunActions}>
        <Link href="/search" className={`${styles.firstRunPrimary} pressable`}>
          <SearchIcon size={17} />
          Search for something
        </Link>
        {hasCharts && (
          <Link href="/playlist/system/top-50-global" className={`${styles.firstRunSecondary} pressable`}>
            Browse today&apos;s charts
          </Link>
        )}
        <Link href="/import" className={`${styles.firstRunSecondary} pressable`}>
          Bring a playlist from Spotify
        </Link>
      </div>
    </div>
  );
}

/* ── Greeting ─────────────────────────────────────────────────────────────
 *
 * Client-side on purpose. The server's clock is not the user's: rendering the
 * greeting during SSR meant someone in Tokyo got "Good evening" because the
 * host happened to be in a US timezone. It resolves from the device's own
 * clock, so the one thing on this page that claims to know the time of day is
 * actually right.
 *
 * `useSyncExternalStore` rather than a mount effect, matching how the rest of
 * the codebase reads browser-owned values (see OfflineBanner, useReducedMotion).
 * The effect version renders once with the wrong answer and again with the
 * right one — a visible flicker on the largest text on the page. This renders
 * the server value during hydration and the real one immediately after, with
 * no intermediate commit.
 */

/** The clock is read, never subscribed to: an hour boundary mid-session isn't
 *  worth a timer, and re-greeting someone at 18:00 would be strange anyway. */
const subscribeNever = () => () => {};

function greetingFor(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const readGreeting = () => greetingFor(new Date().getHours());
/* Server render has no user clock. Empty means "name only" — true at every
 * hour, so nothing has to be corrected a frame later. */
const readGreetingOnServer = () => "";

export function Greeting({ name }: { name: string }) {
  const greeting = useSyncExternalStore(subscribeNever, readGreeting, readGreetingOnServer);

  return <h1 className={styles.greeting}>{greeting ? `${greeting}, ${name}` : name}</h1>;
}
