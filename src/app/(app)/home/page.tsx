"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────
   Types — mirroring the /api/home response shape.
──────────────────────────────────────────────────────────── */
type Track = {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
};

type Artist = {
  id: string;
  name: string;
  trackCount: number;
  avatarUrl?: string | null;
};

type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  coverUrl?: string | null;
};

type HomeData = {
  user: { name: string; avatarUrl?: string | null };
  quickPicks: Track[];
  madeForYou: { id: string; label: string; coverUrl?: string | null; tint: "a" | "b" }[];
  recentlyPlayed: Track[];
  topArtists: Artist[];
  playlists: Playlist[];
};

/* ────────────────────────────────────────────────────────────
   Icons — small inline SVGs, no extra dependency required.
──────────────────────────────────────────────────────────── */
function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function MusicNoteIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white" opacity={0.9}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────── */
function getGreeting(hour: number) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ────────────────────────────────────────────────────────────
   Skeleton — shown while data is loading (mirrors loading.tsx)
──────────────────────────────────────────────────────────── */
function HomeSkeleton() {
  return (
    <div className={styles.page}>
      <div className={styles.skeletonSection}>
        <div className={styles.skeletonHeader} />
        <div className={styles.skeletonGrid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={styles.skeletonGridCell} />
          ))}
        </div>
      </div>
      {[...Array(2)].map((_, s) => (
        <div key={s} className={styles.skeletonSection}>
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonScroll}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className={styles.skeletonScrollItem}>
                <div className={styles.skeletonArt} />
                <div className={styles.skeletonText} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Empty state — first-run experience with no listening history
──────────────────────────────────────────────────────────── */
function EmptyHome() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIllustration}>
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" stroke="var(--sakura-accent)" strokeWidth="1.5" opacity="0.35" />
          <path d="M9 16V7l8-1.5v9" stroke="var(--sakura-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="7" cy="16" r="2.2" stroke="var(--sakura-accent)" strokeWidth="1.5" />
          <circle cx="15" cy="14.5" r="2.2" stroke="var(--sakura-accent)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className={styles.emptyText}>Nothing playing yet</div>
      <div className={styles.emptySubtext}>Search for an artist or album to start your library</div>
      <Link href="/search" className={styles.emptyCta}>
        Find something to play
      </Link>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────── */
export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/home")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<HomeData>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);

  if (!data && !error) return <HomeSkeleton />;

  // On error or truly empty library, show the empty state
  if (error || !data) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.greeting}>{greeting}</h1>
        </header>
        <EmptyHome />
      </div>
    );
  }

  const isEmpty =
    data.quickPicks.length === 0 && data.recentlyPlayed.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.greeting}>
          {greeting}, {data.user.name}
        </h1>
        <Link href="/profile" className={styles.avatarCol} aria-label="Open your profile">
          {data.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.user.avatarUrl} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials(data.user.name)}</div>
          )}
        </Link>
      </header>

      {isEmpty ? (
        <EmptyHome />
      ) : (
        <>
          {data.quickPicks.length > 0 && (
            <div className={styles.quickPicksGrid}>
              {data.quickPicks.map((track) => (
                <button key={track.id} type="button" className={styles.quickPickCard} aria-label={`Play ${track.title}`}>
                  {track.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.coverUrl} alt="" className={styles.quickPickArt} />
                  ) : (
                    <div className={styles.quickPickFallback}>
                      <MusicNoteIcon />
                    </div>
                  )}
                  <div className={styles.quickPickOverlay}>
                    <span className={styles.quickPickPlayBtn}>
                      <PlayIcon />
                    </span>
                  </div>
                  <span className={styles.quickPickTitle}>{track.title}</span>
                </button>
              ))}
            </div>
          )}

          {data.madeForYou.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Made for you</h2>
                <Link href="/library/made-for-you" className={styles.seeAllLink}>
                  See all
                </Link>
              </div>
              <div className={styles.madeForYouGrid}>
                {data.madeForYou.map((mix) => (
                  <button
                    key={mix.id}
                    type="button"
                    className={styles.madeForYouCard}
                    style={
                      !mix.coverUrl
                        ? {
                            background:
                              mix.tint === "a"
                                ? "linear-gradient(135deg, var(--sakura-gradient-start), var(--sakura-accent-2))"
                                : "linear-gradient(135deg, var(--sakura-accent-2), var(--sakura-gradient-end))",
                          }
                        : undefined
                    }
                  >
                    {mix.coverUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mix.coverUrl} alt="" className={styles.madeForYouArt} />
                    )}
                    <span className={styles.madeForYouLabel}>{mix.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {data.recentlyPlayed.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Recently played</h2>
                <Link href="/library/history" className={styles.seeAllLink}>
                  See all
                </Link>
              </div>
              <div className={styles.horizontalScroll}>
                {data.recentlyPlayed.map((track) => (
                  <button key={track.id} type="button" className={styles.trackCard} aria-label={`Play ${track.title}`}>
                    {track.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={track.coverUrl} alt="" className={styles.trackCardArt} />
                    ) : (
                      <div className={styles.trackCardFallback}>
                        <MusicNoteIcon size={22} />
                      </div>
                    )}
                    <div className={styles.trackCardTitle}>{track.title}</div>
                    <div className={styles.trackCardArtist}>{track.artist}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {data.topArtists.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Your top artists</h2>
                <Link href="/library/artists" className={styles.seeAllLink}>
                  See all
                </Link>
              </div>
              <div className={styles.horizontalScroll}>
                {data.topArtists.map((artist) => (
                  <Link key={artist.id} href={`/artist/${artist.id}`} className={styles.artistCard}>
                    <div className={styles.artistAvatarWrap}>
                      {artist.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={artist.avatarUrl} alt="" className={styles.artistAvatar} />
                      ) : (
                        <div className={styles.artistAvatarFallback}>{initials(artist.name)}</div>
                      )}
                    </div>
                    <div className={styles.artistName}>{artist.name}</div>
                    <div className={styles.artistTrackCount}>{artist.trackCount} tracks</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.playlists.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Your playlists</h2>
                <Link href="/library/playlists" className={styles.seeAllLink}>
                  See all
                </Link>
              </div>
              <div className={styles.horizontalScroll}>
                {data.playlists.map((pl) => (
                  <Link key={pl.id} href={`/playlist/${pl.id}`} className={styles.playlistCard}>
                    {pl.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pl.coverUrl} alt="" className={styles.playlistCardArt} />
                    ) : (
                      <div className={styles.playlistCardFallback}>
                        <MusicNoteIcon size={22} />
                      </div>
                    )}
                    <div className={styles.playlistCardName}>{pl.name}</div>
                    <div className={styles.playlistCardCount}>{pl.trackCount} tracks</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
