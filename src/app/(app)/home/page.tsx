"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

/* ────────────────────────────────────────────────────────────
   Types — swap these for your real API/DB shapes.
──────────────────────────────────────────────────────────── */
type Track = {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
};

type Artist = {
  id: string;
  name: string;
  trackCount: number;
  avatarUrl?: string;
};

type Playlist = {
  id: string;
  name: string;
  trackCount: number;
  coverUrl?: string;
};

type HomeData = {
  user: { name: string; avatarUrl?: string };
  quickPicks: Track[];
  madeForYou: { id: string; label: string; coverUrl?: string; tint: "a" | "b" }[];
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
   Mock fetch — replace with your real data source.
──────────────────────────────────────────────────────────── */
async function getHomeData(): Promise<HomeData> {
  return {
    user: { name: "Yuki" },
    quickPicks: [
      { id: "1", title: "Midnight Bloom", artist: "Nao Kobayashi" },
      { id: "2", title: "Glass Rain", artist: "The Paper Kites" },
      { id: "3", title: "Neon Static", artist: "Kiko Aoki" },
      { id: "4", title: "Slow Tide", artist: "Marina Ito" },
      { id: "5", title: "Paper Lanterns", artist: "Hana Sato" },
      { id: "6", title: "Blue Hour", artist: "Ren Fujita" },
    ],
    madeForYou: [
      { id: "m1", label: "Discover Weekly", tint: "a" },
      { id: "m2", label: "Daily Mix 1", tint: "b" },
      { id: "m3", label: "Chill Focus", tint: "a" },
      { id: "m4", label: "Rewind: 2024", tint: "b" },
    ],
    recentlyPlayed: [
      { id: "r1", title: "Evening Static", artist: "Kiko Aoki" },
      { id: "r2", title: "Home Movies", artist: "The Paper Kites" },
      { id: "r3", title: "Sakura Season", artist: "Nao Kobayashi" },
      { id: "r4", title: "Low Light", artist: "Marina Ito" },
      { id: "r5", title: "Departures", artist: "Ren Fujita" },
      { id: "r6", title: "After Hours", artist: "Hana Sato" },
    ],
    topArtists: [
      { id: "a1", name: "Nao Kobayashi", trackCount: 42 },
      { id: "a2", name: "The Paper Kites", trackCount: 31 },
      { id: "a3", name: "Kiko Aoki", trackCount: 18 },
      { id: "a4", name: "Marina Ito", trackCount: 27 },
      { id: "a5", name: "Ren Fujita", trackCount: 15 },
    ],
    playlists: [
      { id: "p1", name: "Rainy Day Focus", trackCount: 48 },
      { id: "p2", name: "Late Night Drive", trackCount: 22 },
      { id: "p3", name: "Sunday Morning", trackCount: 34 },
      { id: "p4", name: "Workout Energy", trackCount: 29 },
    ],
  };
}

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

  useEffect(() => {
    let cancelled = false;
    getHomeData().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);

  if (!data) return <HomeSkeleton />;

  const isEmpty = data.quickPicks.length === 0 && data.recentlyPlayed.length === 0;

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
