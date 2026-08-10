"use client";

import { useEffect, useState, use } from "react";
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

/**
 * Landing page for catalogue entries we don't hold locally.
 *
 * Search surfaces artists and playlists straight from Deezer so a fresh
 * install isn't an empty app. Those results need somewhere to open, and this
 * is it — same layout language as the local artist/playlist pages, so the
 * seam between "ours" and "the wider catalogue" isn't something the user has
 * to think about.
 */
export default function ExternalPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = use(params);
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

  /*
   * Only tracks with real audio are playable. A Deezer row we don't hold has
   * `audioUrl: null` and only a 30-second preview — TrackRow handles offering
   * the download, but the Play/Shuffle buttons must not queue something with
   * nothing to play.
   */
  const playable = (data?.tracks ?? []).filter((t) => t.audioUrl);

  /** The player's Track shape: artist is a plain string here. */
  const playerQueue = playable.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    audioUrl: t.audioUrl as string,
    duration: t.duration,
  }));

  /** TrackRow's shape: artist is nested. */
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
    <div className={styles.page}>
      <header className={styles.hero}>
        {/* Reachable from search and from external links, so back needs a
            destination when there's no history to pop. */}
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

        <p className={styles.eyebrow}>
          {kind === "artist" ? "Artist" : "Playlist"}
        </p>
        <h1 className={styles.title}>{loading ? "Loading…" : data?.name}</h1>

        {data?.ownerName && <p className={styles.meta}>By {data.ownerName}</p>}
        {data?.description && <p className={styles.desc}>{data.description}</p>}
        {!loading && data && !data.unavailable && (
          <p className={styles.meta}>{data.tracks.length} songs</p>
        )}

        {playable.length > 0 && (
          <div className={styles.actions}>
            <button
              className={`${styles.playBtn} pressable`}
              onClick={() => playerQueue[0] && play(playerQueue[0], playerQueue)}
            >
              <PlayIcon size={18} />
              Play
            </button>
            <button
              className={`${styles.shuffleBtn} pressable`}
              onClick={() => {
                const shuffled = [...playerQueue].sort(() => Math.random() - 0.5);
                if (shuffled[0]) play(shuffled[0], shuffled);
              }}
              aria-label="Shuffle"
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
