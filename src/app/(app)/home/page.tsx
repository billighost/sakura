export const dynamic = "force-dynamic";
import Link from "next/link";
import { Suspense } from "react";
import styles from "./page.module.css";
import { auth } from "@/lib/auth";
import { getHomeData } from "@/lib/homeData";
import { redirect } from "next/navigation";

/* ────────────────────────────────────────────────────────────
   Icons
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

function HeartIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  );
}

function DownloadIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
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

function initials(name?: string) {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ────────────────────────────────────────────────────────────
   Skeleton & Empty
──────────────────────────────────────────────────────────── */
export function HomeSkeleton() {
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
    </div>
  );
}

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
      <Link href="/search" className={styles.emptyCta}>Find something to play</Link>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Data Components
──────────────────────────────────────────────────────────── */
async function HomeFeed({ userId }: { userId: string }) {
  const data = await getHomeData(userId);
  const isEmpty = data.quickPicks.length === 0 && data.recentlyPlayed.length === 0;

  if (isEmpty) return <EmptyHome />;

  return (
    <>
      {/* Top Row Collections */}
      <div className={styles.topRowGrid}>
        <Link href="/library/liked" className={styles.topRowCard}>
          <div className={styles.topRowIconWrap} style={{ background: 'linear-gradient(135deg, #4f46e5, #ec4899)' }}>
            <HeartIcon />
          </div>
          <span className={styles.topRowTitle}>Liked Songs</span>
        </Link>
        <Link href="/library/downloaded" className={styles.topRowCard}>
          <div className={styles.topRowIconWrap} style={{ background: 'linear-gradient(135deg, #10b981, #3b82f6)' }}>
            <DownloadIcon />
          </div>
          <span className={styles.topRowTitle}>Downloaded</span>
        </Link>
        {data.playlists.slice(0, 4).map(pl => (
          <Link key={pl.id} href={`/playlist/${pl.id}`} className={styles.topRowCard}>
            {pl.coverUrl ? (
              <img src={pl.coverUrl} alt="" className={styles.topRowIconWrap} style={{ padding: 0 }} />
            ) : (
              <div className={styles.topRowIconWrap} style={{ background: 'var(--sakura-bg-hover)' }}>
                <MusicNoteIcon size={20} />
              </div>
            )}
            <span className={styles.topRowTitle}>{pl.name}</span>
          </Link>
        ))}
      </div>

      {/* Made For You (Custom Mixes) */}
      {data.madeForYou && data.madeForYou.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Made for you</h2>
            <Link href="/library/made-for-you" className={styles.seeAllLink}>See all</Link>
          </div>
          <div className={styles.madeForYouGrid}>
            {data.madeForYou.map((mix) => (
              <Link
                key={mix.id}
                href={`/mix/${mix.id}`}
                className={styles.madeForYouCard}
                style={!mix.coverUrl ? {
                  background: mix.tint === "a"
                    ? "linear-gradient(135deg, var(--sakura-gradient-start), var(--sakura-accent-2))"
                    : "linear-gradient(135deg, var(--sakura-accent-2), var(--sakura-gradient-end))"
                } : undefined}
              >
                {mix.coverUrl && <img src={mix.coverUrl} alt="" className={styles.madeForYouArt} />}
                <span className={styles.madeForYouLabel}>{mix.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top Charts */}
      {data.systemPlaylists && data.systemPlaylists.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Top Charts</h2>
          </div>
          <div className={styles.horizontalScroll}>
            {data.systemPlaylists.map((pl) => (
              <Link key={pl.id} href={`/playlist/system/${pl.systemId}`} className={styles.playlistCard}>
                {pl.coverUrl ? (
                  <img src={pl.coverUrl} alt="" className={styles.playlistCardArt} />
                ) : (
                  <div className={styles.playlistCardFallback} style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}>
                    <MusicNoteIcon size={32} />
                  </div>
                )}
                <div className={styles.playlistCardName}>{pl.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently Played */}
      {data.recentlyPlayed.length > 0 && (
          <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recently played</h2>
          </div>
          <div className={styles.horizontalScroll}>
            {data.recentlyPlayed.map((track) => (
              <Link key={track.id} href={`/track/${track.id}`} className={styles.trackCard}>
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className={styles.trackCardArt} />
                ) : (
                  <div className={styles.trackCardFallback}><MusicNoteIcon size={22} /></div>
                )}
                <div className={styles.trackCardTitle}>{track.title}</div>
                <div className={styles.trackCardArtist}>{track.artist}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top Artists */}
      {data.topArtists.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Your top artists</h2>
          </div>
          <div className={styles.horizontalScroll}>
            {data.topArtists.map((artist) => (
              <Link key={artist.id} href={`/artist/${artist.id}`} className={styles.artistCard}>
                <div className={styles.artistAvatarWrap}>
                  {artist.avatarUrl ? (
                    <img src={artist.avatarUrl} alt="" className={styles.artistAvatar} />
                  ) : (
                    <div className={styles.artistAvatarFallback}>{initials(artist.name)}</div>
                  )}
                </div>
                <div className={styles.artistName}>{artist.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   Page (Server Component)
──────────────────────────────────────────────────────────── */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const greeting = getGreeting(new Date().getHours());
  const user = session.user;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.greeting}>
          {greeting}, {user.name}
        </h1>
        <Link href="/profile" className={styles.avatarCol} aria-label="Open your profile">
          {user.image ? (
            <img src={user.image} alt="" className={styles.avatar} />
          ) : (
            <div className={styles.avatarPlaceholder}>{initials(user.name || "?")}</div>
          )}
        </Link>
      </header>
      <Suspense fallback={<HomeSkeleton />}>
        <HomeFeed userId={user.id!} />
      </Suspense>
    </div>
  );
}
