"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface Track {
  id: string;
  title: string;
  artist: { name: string };
  album?: { title: string; coverUrl?: string } | null;
  coverUrl?: string;
  duration: number;
}

interface Profile {
  username?: string;
  avatarUrl?: string;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const [recentTracks, setRecentTracks] = useState<Track[]>([]);
  const [newTracks, setNewTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [greeting] = useState(getGreeting);
  const [profile, setProfile] = useState<Profile | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [tracksRes, historyRes, profileRes] = await Promise.allSettled([
        fetch("/api/tracks?limit=10").then((r) => r.json()),
        fetch("/api/history?limit=10").then((r) => r.json()),
        fetch("/api/profile").then((r) => r.json()),
      ]);
      if (tracksRes.status === "fulfilled") {
        setNewTracks(tracksRes.value.tracks || tracksRes.value || []);
      }
      if (historyRes.status === "fulfilled") {
        setRecentTracks(historyRes.value.tracks || historyRes.value || []);
      }
      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value);
      }
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.greeting}>{greeting}</div>
        </div>
        <div className={styles.avatarCol}>
          {profile?.avatarUrl ? (
            <img className={styles.avatar} src={profile.avatarUrl} alt="" />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {profile?.username?.charAt(0)?.toUpperCase() || "S"}
            </div>
          )}
        </div>
      </div>

      {refreshing && (
        <div className={styles.refreshIndicator}>
          <div className={styles.refreshSpinner} />
        </div>
      )}

      {loading ? (
        <>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.skeletonTitle} />
            </div>
            <div className={styles.horizontalScroll}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className={styles.quickCard}>
                  <div className={styles.skeletonArt} />
                  <div className={styles.skeletonText} />
                </div>
              ))}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.skeletonTitle} />
            </div>
            <div className={styles.horizontalScroll}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className={styles.quickCard}>
                  <div className={styles.skeletonArt} />
                  <div className={styles.skeletonText} />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {recentTracks.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Recently Played</span>
              </div>
              <div className={styles.horizontalScroll}>
                {recentTracks.map((track) => (
                  <Link key={track.id} href={`/album/${track.album?.title || "unknown"}`} className={styles.quickCard}>
                    {track.coverUrl || track.album?.coverUrl ? (
                      <img className={styles.quickCardArt} src={track.coverUrl || track.album?.coverUrl} alt="" />
                    ) : (
                      <div className={`${styles.quickCardArt} ${styles.fallbackArt}`}>
                        <span>🎵</span>
                      </div>
                    )}
                    <div className={styles.quickCardTitle}>{track.title}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {newTracks.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>New Arrivals</span>
              </div>
              <div className={styles.horizontalScroll}>
                {newTracks.slice(0, 10).map((track) => (
                  <Link key={track.id} href={`/album/${track.album?.title || "unknown"}`} className={styles.quickCard}>
                    {track.coverUrl || track.album?.coverUrl ? (
                      <img className={styles.quickCardArt} src={track.coverUrl || track.album?.coverUrl} alt="" />
                    ) : (
                      <div className={`${styles.quickCardArt} ${styles.fallbackArtAlt}`}>
                        <span>🎶</span>
                      </div>
                    )}
                    <div className={styles.quickCardTitle}>{track.title}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {newTracks.length === 0 && recentTracks.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIllustration}>
                <svg viewBox="0 0 120 120" width="120" height="120" fill="none">
                  <circle cx="60" cy="60" r="56" stroke="var(--sakura-border)" strokeWidth="2" />
                  <circle cx="60" cy="60" r="32" stroke="var(--sakura-accent)" strokeWidth="2" opacity="0.4" />
                  <circle cx="60" cy="60" r="12" fill="var(--sakura-accent)" opacity="0.3" />
                  <path d="M60 32 C60 32 72 48 72 60 C72 68 66 74 60 74 C54 74 48 68 48 60 C48 48 60 32 60 32Z" fill="var(--sakura-accent)" opacity="0.15" />
                  <circle cx="42" cy="44" r="3" fill="var(--sakura-accent-2)" opacity="0.5" />
                  <circle cx="78" cy="50" r="2" fill="var(--sakura-accent)" opacity="0.4" />
                  <circle cx="50" cy="80" r="2.5" fill="var(--sakura-accent-2)" opacity="0.3" />
                </svg>
              </div>
              <p className={styles.emptyText}>Your library is empty</p>
              <p className={styles.emptySubtext}>Start exploring and add some music</p>
              <Link href="/search" className={styles.emptyCta}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                Search Music
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
