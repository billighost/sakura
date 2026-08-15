"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TrackRow } from "@/components/TrackRow";
import { BackButton } from "@/components/BackButton";
import {
  PlayIcon,
  ShuffleIcon,
  UserIcon,
  PlaylistIcon,
  AlertIcon,
} from "@/components/Icons";
import { usePlayer } from "@/components/PlayerContext";
import styles from "./page.module.css";

interface ExternalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  preview: string;
  source: "library" | "deezer";
  audioUrl: string | null;
  isDownloaded: boolean;
}

interface ExternalData {
  kind: "artist" | "playlist";
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  coverUrl?: string | null;
  ownerName?: string | null;
  followers?: number | null;
  tracks: ExternalTrack[];
  unavailable?: boolean;
}

export function BrowseLoadingState() {
  return (
    <div className={styles.page} data-page-scroll>
      <header className={styles.hero}>
        <BackButton className={styles.back} fallback="/search" />
        <div className={`${styles.cover} skeleton`} />
        <div className={styles.meta}>
          <div className="skeleton" style={{ width: "3.5rem", height: "0.75rem", borderRadius: "4px" }} />
          <div className="skeleton" style={{ width: "12rem", height: "2rem", borderRadius: "6px" }} />
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.skeletons}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={`${styles.skeletonThumb} skeleton`} />
              <div className={styles.skeletonCol}>
                <div className={`${styles.skeletonLine} skeleton`} />
                <div className={`${styles.skeletonLineShort} skeleton`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BrowseClient({ kind, id }: { kind: string; id: string }) {
  const router = useRouter();
  const { play } = usePlayer();

  const [data, setData] = useState<ExternalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/external/${kind}/${id}`);
        const json = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setError(json.error || "Couldn't load this.");
          return;
        }
        setData(json);
      } catch {
        if (!cancelled) setError("Couldn't load this. Check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const cover = data?.coverUrl || data?.imageUrl || null;

  const playable = (data?.tracks ?? []).filter((t) => t.audioUrl);

  const playerQueue = playable.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl as string,
    duration: t.duration,
  }));

  const rowQueue = (data?.tracks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    artist: { name: t.artist },
    album: { title: t.album, coverUrl: t.coverUrl },
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl || undefined,
    duration: t.duration,
    source: t.source,
  }));

  return (
    <div className={styles.page} data-page-scroll>
      <header className={styles.hero}>
        <BackButton className={styles.back} fallback="/search" />

        <div className={`${styles.cover} ${kind === "artist" ? styles.coverRound : ""}`}>
          {cover ? (
            <img src={cover} alt="" />
          ) : kind === "artist" ? (
            <UserIcon size={40} />
          ) : (
            <PlaylistIcon size={40} />
          )}
        </div>

        <div className={styles.meta}>
          <span className={styles.kind}>{kind}</span>
          <h1 className={styles.title}>{data?.name || "..."}</h1>

          {data?.description && (
            <p className={styles.description}>{data.description}</p>
          )}

          <div className={styles.byline}>
            {data?.ownerName && <span>By {data.ownerName}</span>}
            {data?.followers != null && (
              <span>{data.followers.toLocaleString()} followers</span>
            )}
            {data?.tracks && <span>{data.tracks.length} tracks</span>}
          </div>
        </div>

        {playable.length > 0 && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.playBtn}
              onClick={() => play(playerQueue[0], playerQueue)}
            >
              <PlayIcon size={18} />
              Play
            </button>
            <button
              type="button"
              className={styles.shuffleBtn}
              onClick={() => {
                const shuffled = [...playerQueue].sort(
                  () => Math.random() - 0.5,
                );
                play(shuffled[0], shuffled);
              }}
            >
              <ShuffleIcon size={18} />
              Shuffle
            </button>
          </div>
        )}
      </header>

      <div className={styles.body}>
        {loading && (
          <div className={styles.skeletons}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <div className={`${styles.skeletonThumb} skeleton`} />
                <div className={styles.skeletonCol}>
                  <div className={`${styles.skeletonLine} skeleton`} />
                  <div className={`${styles.skeletonLineShort} skeleton`} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && (error || data?.unavailable) && (
          <div className={styles.notice}>
            <AlertIcon size={30} />
            <p className={styles.noticeText}>
              {data?.description || error}
            </p>
            <button className={styles.noticeBtn} onClick={() => router.back()}>
              Go back
            </button>
          </div>
        )}

        {!loading && data && !data.unavailable && data.tracks.length > 0 && (
          <div className={`${styles.list} anim-stagger`}>
            {rowQueue.map((t, i) => (
              <div key={t.id} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <TrackRow track={t} queue={rowQueue} index={i} />
              </div>
            ))}
          </div>
        )}

        {!loading && data && !data.unavailable && data.tracks.length === 0 && (
          <p className={styles.emptyText}>Nothing to play here.</p>
        )}
      </div>
    </div>
  );
}
