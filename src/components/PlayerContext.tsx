"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getAudioBlob, getCachedUserId, getDeviceId, isTrackDownloaded, saveTrackOffline, saveAudioBlob, findDownloadedTrackByMetadata, cloneDownloadedTrack } from "@/lib/offline-db";
import { extractDominantColor } from "@/lib/color";
import { getLyrics, LyricData } from "@/lib/lyrics";
import { signalTracker } from "@/lib/signals";
import {
  pushPlaybackState,
  fetchPlaybackState,
  shouldAdoptRemote,
  HEARTBEAT_MS,
  type PlaybackSnapshot,
} from "@/lib/playbackSync";
import { Toast } from "./Toast";

interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
  /** Set when the radio queued this track rather than the listener. */
  autoplay?: boolean;
  /** Human-readable "why this is here", shown in the queue UI. */
  reason?: string;
}

/** Where the current queue came from — recorded with every play signal. */
export type PlayContext = {
  context: string | null;
  contextId: string | null;
};

export interface DownloadItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration: number;
  priority: number;
  albumId?: string;
}

interface PlayerContextType {
  queue: Track[];
  upNextQueue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  isSeeking: boolean;
  progress: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  play: (track: Track, queue?: Track[]) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  beginSeek: () => void;
  endSeek: (time?: number) => void;
  seekTo: (time: number) => void;
  lyrics: LyricData | null;
  loadingLyrics: boolean;
  activeLyricIndex: number;
  activeLyricLine: string | null;
  setVolume: (vol: number) => void;
  next: () => void;
  prev: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  goToQueueItem: (absoluteIndex: number) => void;
  removeTrack: (trackId: string) => void;
  removeTracks: (trackIds: string[]) => void;
  reshuffleQueue: () => void;
  isLiked: boolean;
  toggleLiked: () => void;
  favoriteTrackIds: Set<string>;
  toggleLikeTrack: (trackId: string) => Promise<void>;
  accentColor: string | null;
  miniArtRect: DOMRect | null;
  setMiniArtRect: (rect: DOMRect | null) => void;
  removeFromUpNext: (trackId: string) => void;
  reorderUpNext: (fromIndex: number, toIndex: number) => void;
  reorderQueueTail: (fromIndex: number, toIndex: number) => void;
  toast: { message: string; type: "accent" | "error" | "success"; visible: boolean } | null;
  showToast: (message: string, type?: "accent" | "error" | "success") => void;
  hideToast: () => void;
  sleepTimerMinutes: number | null;
  setSleepTimer: (minutes: number | null) => void;

  // Radio / endless playback
  /** When on, an exhausted queue is refilled with taste-matched tracks. */
  autoplayRadio: boolean;
  setAutoplayRadio: (on: boolean) => void;
  /** True while a radio batch is being fetched. */
  radioLoading: boolean;
  /** Start a radio seeded from a specific track. */
  startRadio: (seedTrack?: Track) => Promise<void>;
  /** Set the origin of the current queue so play signals carry context. */
  setPlayContext: (ctx: PlayContext) => void;

  // Download Manager fields
  downloadQueue: DownloadItem[];
  downloadStates: Record<string, "idle" | "queued" | "downloading" | "completed" | "failed">;
  downloadProgress: Record<string, number>;
  downloadSpeed: Record<string, string>;
  addToDownloadQueue: (tracks: Omit<DownloadItem, "priority">[], priorityBoost?: boolean) => void;
  removeFromDownloadQueue: (trackId: string) => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

/**
 * Write a value to localStorage, debounced, and flush it on unload.
 *
 * Serializing a long queue is a synchronous main-thread cost, and the queue
 * changes far more often than anyone could benefit from persisting — a radio
 * refill alone appends 15-20 tracks at once. The unload/visibility flush is
 * what makes the delay safe: the moments a person actually leaves are covered
 * synchronously, so the debounce can never lose real state.
 */
function useDebouncedStorage(key: string, value: unknown, delayMs = 500) {
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch {
        // Quota exceeded or storage blocked — persistence is best-effort and
        // must never interrupt playback.
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, value, delayMs]);

  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch {
        /* see above */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [key]);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
  // Tracks whether we've already applied the saved "resume where you left off"
  // position once this session. Must live at component scope (a ref, not a
  // local variable inside the load effect) — otherwise it resets to true on
  // *every* track change, not just the page's first load, and skipping to the
  // next track would wrongly re-seek to an old saved position instead of playing.
  const hasRestoredProgressRef = useRef(false);
  const lastProgressSaveRef = useRef(0);
  const loadedTrackIdRef = useRef<string | null>(null);
  const [queue, setQueueState] = useState<Track[]>([]);
  const [upNextQueue, setUpNextQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "one" | "all">("off");
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: "accent" | "error" | "success"; visible: boolean } | null>(null);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const sleepTimerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Radio / endless playback ──────────────────────────────────────────────
  const [autoplayRadio, setAutoplayRadioState] = useState(true);
  const [radioLoading, setRadioLoading] = useState(false);
  const playContextRef = useRef<PlayContext>({ context: null, contextId: null });
  // Guards against two radio fetches racing when `ended` and `next` both fire.
  const radioFetchingRef = useRef(false);
  // Tracks consecutive empty radio responses so a catalogue with nothing left
  // to offer stops hammering the endpoint on every track end.
  const radioMissesRef = useRef(0);

  const showToast = useCallback((message: string, type: "accent" | "error" | "success" = "accent") => {
    setToast({ message, type, visible: true });
  }, []);

  const hideToast = useCallback(() => {
    setToast((prev) => prev ? { ...prev, visible: false } : null);
  }, []);
  const [isSeeking, setIsSeeking] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [miniArtRect, setMiniArtRect] = useState<DOMRect | null>(null);
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState(false);

  // Centralized Download Queue States
  const [downloadQueue, setDownloadQueue] = useState<DownloadItem[]>([]);
  const [downloadStates, setDownloadStates] = useState<Record<string, "idle" | "queued" | "downloading" | "completed" | "failed">>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadSpeed, setDownloadSpeed] = useState<Record<string, string>>({});
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);
  const [downloadPaused, setDownloadPaused] = useState(false);

  // Sync downloadQueue to localStorage — see useDebouncedStorage below.

  // Battery and Visibility Checker
  useEffect(() => {
    let checkInterval: NodeJS.Timeout | null = null;

    async function checkBatteryAndVisibility() {
      const isHidden = document.visibilityState === "hidden";
      if (!isHidden) {
        setDownloadPaused(false);
        return;
      }

      try {
        if ("getBattery" in navigator) {
          const battery: any = await (navigator as any).getBattery();
          if (battery.level < 0.2 && !battery.charging) {
            setDownloadPaused(true);
            return;
          }
        }
      } catch (e) {
        console.error("Battery check failed", e);
      }
      setDownloadPaused(false);
    }

    const handleVisibility = () => {
      checkBatteryAndVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    checkInterval = setInterval(() => {
      if (document.visibilityState === "hidden") {
        checkBatteryAndVisibility();
      }
    }, 15000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  // Helper to add tracks to queue.
  //
  // Both state updates are issued as independent functional updates. The
  // previous version mutated `prev[i].priority` in place and called
  // setDownloadStates from inside the setDownloadQueue updater — updaters have
  // to be pure, and React may invoke them more than once (StrictMode does so
  // deliberately), which made the nested update fire twice and the in-place
  // mutation invisible to change detection.
  const addToDownloadQueue = useCallback((tracks: Omit<DownloadItem, "priority">[], priorityBoost = false) => {
    setDownloadQueue((prev) => {
      const existingById = new Map(prev.map((item) => [item.id, item]));
      const newItems: DownloadItem[] = [];
      let boosted = false;

      for (const track of tracks) {
        const existing = existingById.get(track.id);
        if (existing) {
          if (priorityBoost && existing.priority < 10) {
            existingById.set(track.id, { ...existing, priority: 10 });
            boosted = true;
          }
          continue;
        }
        newItems.push({ ...track, priority: priorityBoost ? 10 : 1 });
      }

      if (newItems.length === 0 && !boosted) return prev;

      return [...prev.map((item) => existingById.get(item.id) ?? item), ...newItems].sort(
        (a, b) => b.priority - a.priority
      );
    });

    setDownloadStates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const track of tracks) {
        // Don't re-queue something already finished or in flight.
        if (next[track.id] === "completed" || next[track.id] === "downloading") continue;
        if (next[track.id] === "queued") continue;
        next[track.id] = "queued";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const removeFromDownloadQueue = useCallback((trackId: string) => {
    setDownloadQueue((prev) => prev.filter((item) => item.id !== trackId));
    setDownloadStates((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
  }, []);

  // Background sequential download loop
  useEffect(() => {
    if (activeDownloadId || downloadQueue.length === 0 || downloadPaused) return;

    const item = downloadQueue[0];
    setActiveDownloadId(item.id);

    async function startDownload() {
      const uId = getCachedUserId();
      const dId = getDeviceId();
      
      const alreadyDownloaded = await isTrackDownloaded(item.id, uId, dId);
      if (alreadyDownloaded) {
        setDownloadStates((prev) => ({ ...prev, [item.id]: "completed" }));
        setDownloadQueue((prev) => prev.filter((q) => q.id !== item.id));
        setActiveDownloadId(null);
        return;
      }

      // Check if we already have this song downloaded under a different database ID (match by title + artist)
      const existingMatch = await findDownloadedTrackByMetadata(item.title, item.artist, uId, dId);
      if (existingMatch) {
        const cloned = await cloneDownloadedTrack(existingMatch.id, item.id, {
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverUrl: item.coverUrl,
          audioUrl: item.audioUrl || existingMatch.audioUrl,
          duration: item.duration,
        }, uId, dId);
        
        if (cloned) {
          setDownloadStates((prev) => ({ ...prev, [item.id]: "completed" }));
          setDownloadQueue((prev) => prev.filter((q) => q.id !== item.id));
          setActiveDownloadId(null);
          return;
        }
      }

      setDownloadStates((prev) => ({ ...prev, [item.id]: "downloading" }));

      try {
        let finalAudioUrl = item.audioUrl;
        let finalId = item.id;
        let finalCoverUrl = item.coverUrl;

        // If it's a Deezer track that needs Telegram downloading first
        if (!finalAudioUrl || finalId.startsWith("deezer-")) {
          const res = await fetch("/api/music/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: item.title,
              artist: item.artist,
              duration: item.duration,
              albumId: item.albumId,
            }),
          });
          const data = await res.json();
          if (data.error || !data.audioUrl) throw new Error(data.error || "Auto-download failed");

          finalAudioUrl = data.audioUrl;
          finalId = data.id;
          finalCoverUrl = data.coverUrl || finalCoverUrl;
        }

        const blobRes = await fetch(finalAudioUrl!);
        if (!blobRes.ok) throw new Error("Failed to fetch audio stream");

        const contentLength = blobRes.headers.get("content-length");
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = blobRes.body!.getReader();
        const chunks: BlobPart[] = [];
        let bytesLoaded = 0;
        const startTime = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value as BlobPart);
          bytesLoaded += value.length;

          if (totalBytes > 0) {
            const progressPct = Math.round((bytesLoaded / totalBytes) * 100);
            setDownloadProgress((prev) => ({ ...prev, [item.id]: progressPct, [finalId]: progressPct }));
          }

          const elapsedSec = (Date.now() - startTime) / 1000;
          if (elapsedSec > 0) {
            const bytesPerSec = bytesLoaded / elapsedSec;
            const speedText = bytesPerSec > 1024 * 1024
              ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M/s`
              : `${(bytesPerSec / 1024).toFixed(0)}K/s`;
            setDownloadSpeed((prev) => ({ ...prev, [item.id]: speedText, [finalId]: speedText }));
          }
        }

        const blob = new Blob(chunks, { type: blobRes.headers.get("content-type") || "audio/mpeg" });

        await saveTrackOffline({
          id: finalId,
          title: item.title,
          artist: item.artist,
          album: item.album,
          audioUrl: finalAudioUrl!,
          coverUrl: finalCoverUrl,
          duration: item.duration,
        }, uId, dId);
        await saveAudioBlob(finalId, blob, uId, dId);

        setDownloadStates((prev) => ({ ...prev, [item.id]: "completed", [finalId]: "completed" }));
      } catch (err) {
        console.error("Centralized download failed for track:", item.id, err);
        setDownloadStates((prev) => ({ ...prev, [item.id]: "failed" }));
      } finally {
        setDownloadQueue((prev) => prev.filter((q) => q.id !== item.id));
        setActiveDownloadId(null);
      }
    }

    startDownload();
  }, [downloadQueue, activeDownloadId, downloadPaused]);

  // Priority boost for upcoming tracks in the play queue
  useEffect(() => {
    if (downloadQueue.length === 0) return;

    const upcomingIds = new Set<string>();
    
    // Boost current track
    if (queue[currentIndex]) {
      upcomingIds.add(queue[currentIndex].id);
    }
    
    // Boost next 4 tracks in queue
    for (let i = 1; i <= 4; i++) {
      const idx = currentIndex + i;
      if (idx < queue.length) {
        upcomingIds.add(queue[idx].id);
      }
    }

    // Boost next 4 tracks in upNextQueue
    for (let i = 0; i < Math.min(upNextQueue.length, 4); i++) {
      upcomingIds.add(upNextQueue[i].id);
    }

    setDownloadQueue((prev) => {
      let changed = false;
      const nextQ = prev.map((item) => {
        if (upcomingIds.has(item.id) && item.priority < 10) {
          changed = true;
          return { ...item, priority: 10 };
        }
        return item;
      });

      if (!changed) return prev;
      return nextQ.sort((a, b) => b.priority - a.priority);
    });
  }, [currentIndex, queue, upNextQueue, downloadQueue.length]);

  const currentTrack = queue[currentIndex] || null;
  const isLiked = currentTrack ? favoriteTrackIds.has(currentTrack.id) : false;

  // Announce track changes for screen reader users (aria-live region rendered below)
  const [announcement, setAnnouncement] = useState("");
  const firstTrackRef = useRef(true);
  useEffect(() => {
    if (!currentTrack) return;
    if (firstTrackRef.current) {
      firstTrackRef.current = false;
      return;
    }
    setAnnouncement(`Now playing ${currentTrack.title} by ${currentTrack.artist}`);
  }, [currentTrack?.id]);

  // Derive a per-track "mood" accent color from the cover art
  useEffect(() => {
    const lockedAccent = localStorage.getItem("sakura-player-custom-accent");
    if (lockedAccent) {
      setAccentColor(lockedAccent);
      return;
    }

    let cancelled = false;
    if (!currentTrack?.coverUrl) {
      setAccentColor(null);
      return;
    }
    extractDominantColor(currentTrack.coverUrl).then((color) => {
      if (!cancelled) setAccentColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.coverUrl]);

  // Load lyrics for the current track. Lifted up to context (rather than living only
  // inside FullPlayer) so MiniPlayer can also show a live "now playing" lyric line.
  useEffect(() => {
    let cancelled = false;
    setLyrics(null);
    if (!currentTrack) return;
    setLoadingLyrics(true);
    getLyrics(currentTrack)
      .then((data) => {
        if (!cancelled) setLyrics(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingLyrics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  const activeLyricIndex = useMemo(() => {
    if (!lyrics?.lines?.length) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].time <= progress) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [lyrics, progress]);

  const activeLyricLine = useMemo(() => {
    if (!lyrics?.lines?.length) return null;
    return lyrics.lines[activeLyricIndex]?.text || null;
  }, [lyrics, activeLyricIndex]);

  // Load favorites on mount
  useEffect(() => {
    fetch("/api/favorites")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.tracks || [];
        setFavoriteTrackIds(new Set(list.map((t: any) => t.id)));
      })
      .catch(() => {});
  }, []);

  const toggleLikeTrack = useCallback(async (trackId: string) => {
    const wasLiked = favoriteTrackIds.has(trackId);
    // Optimistic update
    setFavoriteTrackIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });

    try {
      if (wasLiked) {
        await fetch(`/api/favorites/${trackId}`, { method: "DELETE" });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId }),
        });
      }
    } catch (err) {
      console.error("Failed to toggle liked state", err);
      // Revert on error
      setFavoriteTrackIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) {
          next.add(trackId);
        } else {
          next.delete(trackId);
        }
        return next;
      });
    }
  }, [favoriteTrackIds]);

  const toggleLiked = useCallback(() => {
    if (currentTrack) {
      toggleLikeTrack(currentTrack.id);
    }
  }, [currentTrack, toggleLikeTrack]);

  // Use refs to avoid stale closures in event handlers
  const queueRef = useRef(queue);
  const upNextRef = useRef(upNextQueue);
  const currentIndexRef = useRef(currentIndex);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  const isPlayingRef = useRef(isPlaying);
  const autoplayRadioRef = useRef(autoplayRadio);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { upNextRef.current = upNextQueue; }, [upNextQueue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { autoplayRadioRef.current = autoplayRadio; }, [autoplayRadio]);

  const goToTrack = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const setSleepTimer = useCallback((minutes: number | null) => {
    setSleepTimerMinutes(minutes);
    if (sleepTimerTimeoutRef.current) {
      clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }
    if (minutes !== null) {
      showToast(`Sleep timer set for ${minutes} minutes`, "success");
      sleepTimerTimeoutRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setIsPlaying(false);
        setSleepTimerMinutes(null);
        showToast("Sleep timer ended. Playback paused.", "accent");
      }, minutes * 60 * 1000);
    } else {
      showToast("Sleep timer cancelled", "success");
    }
  }, []);

  // Jump to a specific absolute index in the queue and start playing
  const goToQueueItem = useCallback((absoluteIndex: number) => {
    setCurrentIndex(absoluteIndex);
    setIsPlaying(true);
    // Trigger play after state settles
    setTimeout(() => {
      audioRef.current?.play().catch(() => {});
    }, 50);
  }, []);

  // ── Radio ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a batch of taste-matched tracks and append them to the queue.
   *
   * Returns the number of tracks appended. Exclusions cover everything already
   * queued so the radio never hands back a song the listener is about to hear
   * anyway.
   */
  const fetchRadioBatch = useCallback(
    async (seedTrackId: string | null, limit = 20): Promise<number> => {
      if (radioFetchingRef.current) return 0;
      radioFetchingRef.current = true;
      setRadioLoading(true);

      try {
        const exclude = [
          ...queueRef.current.map((t) => t.id),
          ...upNextRef.current.map((t) => t.id),
        ];

        const res = await fetch("/api/radio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seedTrackId, limit, excludeTrackIds: exclude }),
        });
        if (!res.ok) return 0;

        const data = await res.json();
        const tracks: Track[] = (data?.tracks ?? [])
          .filter((t: any) => t?.id && t?.audioUrl)
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            artistId: t.artistId ?? undefined,
            album: t.album ?? undefined,
            albumId: t.albumId ?? undefined,
            coverUrl: t.coverUrl ?? undefined,
            audioUrl: t.audioUrl,
            duration: t.duration ?? 0,
            autoplay: true,
            reason: t.reason,
          }));

        if (tracks.length === 0) {
          radioMissesRef.current += 1;
          return 0;
        }

        radioMissesRef.current = 0;
        setQueueState((prev) => {
          // Filter against the live queue too — it may have changed while the
          // request was in flight.
          const existing = new Set(prev.map((t) => t.id));
          const fresh = tracks.filter((t) => !existing.has(t.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        return tracks.length;
      } catch (err) {
        console.error("[Radio] Failed to fetch radio batch:", err);
        radioMissesRef.current += 1;
        return 0;
      } finally {
        radioFetchingRef.current = false;
        setRadioLoading(false);
      }
    },
    []
  );

  /**
   * Advance to the next track. Single source of truth for "what plays next" —
   * the ended handler, the error handler, and the manual next button all route
   * through here. Keeping three copies of this logic in sync by hand is how
   * they quietly drift apart.
   *
   * @param opts.autoplay true when playback should continue automatically
   *                      (track ended / errored) rather than only moving the
   *                      cursor (manual skip while paused).
   */
  const advance = useCallback(
    (opts: { autoplay: boolean }) => {
      const resumeIfNeeded = () => {
        if (!opts.autoplay) return;
        // State has to settle before the new src is loaded and playable.
        setTimeout(() => {
          audioRef.current?.play().catch(() => {});
        }, 50);
      };

      // 1. Explicit "play next" items always win.
      const uq = upNextRef.current;
      if (uq.length > 0) {
        const nextTrack = uq[0];
        setUpNextQueue((prev) => prev.slice(1));
        setQueueState((prev) => {
          const newQ = [...prev];
          newQ.splice(currentIndexRef.current + 1, 0, nextTrack);
          return newQ;
        });
        setCurrentIndex((i) => i + 1);
        resumeIfNeeded();
        return;
      }

      const q = queueRef.current;
      const ci = currentIndexRef.current;
      const sh = shuffleRef.current;
      const rp = repeatRef.current;

      if (q.length === 0) return;

      if (sh) {
        let nextIdx = Math.floor(Math.random() * q.length);
        if (q.length > 1) {
          while (nextIdx === ci) nextIdx = Math.floor(Math.random() * q.length);
        }
        setCurrentIndex(nextIdx);
        resumeIfNeeded();
        return;
      }

      if (ci < q.length - 1) {
        setCurrentIndex(ci + 1);
        resumeIfNeeded();
        return;
      }

      if (rp === "all") {
        setCurrentIndex(0);
        resumeIfNeeded();
        return;
      }

      // 2. Queue exhausted. This is the whole point of the radio: rather than
      //    going silent, keep playing music that fits their taste.
      //    `radioMissesRef` stops us retrying forever against a catalogue that
      //    genuinely has nothing left to offer.
      if (autoplayRadioRef.current && radioMissesRef.current < 3) {
        const seedId = q[ci]?.id ?? null;
        fetchRadioBatch(seedId).then((added) => {
          if (added > 0) {
            setCurrentIndex(ci + 1);
            resumeIfNeeded();
          } else {
            setIsPlaying(false);
            audioRef.current?.pause();
          }
        });
        return;
      }

      // 3. Nothing left and radio is off — stop cleanly.
      setIsPlaying(false);
      audioRef.current?.pause();
    },
    [fetchRadioBatch]
  );

  const next = useCallback(() => {
    // A manual skip should keep playing if we were already playing.
    advance({ autoplay: isPlayingRef.current });
  }, [advance]);

  // ── Play-signal tracking ──────────────────────────────────────────────────
  // Every track change opens a new measurement window. The tracker itself
  // handles closing out the previous one and batching to the server.
  useEffect(() => {
    signalTracker.start();
    return () => {
      // Flush whatever is pending if the provider ever unmounts.
      signalTracker.endTrack({ positionMs: audioRef.current?.currentTime ? audioRef.current.currentTime * 1000 : 0 });
      signalTracker.flush();
    };
  }, []);

  useEffect(() => {
    if (!currentTrack) return;
    signalTracker.beginTrack(currentTrack.id, (currentTrack.duration || 0) * 1000, {
      context: playContextRef.current.context,
      contextId: playContextRef.current.contextId,
      autoplay: currentTrack.autoplay ?? false,
    });
    // If audio is already rolling, start counting immediately — the `play`
    // event won't fire again for a track that's mid-stream.
    if (isPlayingRef.current) signalTracker.resume();
  }, [currentTrack?.id]);

  /**
   * Keep the radio a few tracks ahead.
   *
   * Waiting for the queue to fully drain means a gap of dead air while the
   * request goes out. Refilling once only two tracks remain makes the
   * transition seamless.
   */
  useEffect(() => {
    if (!autoplayRadio) return;
    if (queue.length === 0) return;
    if (repeat === "all" || repeat === "one") return;
    if (upNextQueue.length > 0) return;
    if (radioMissesRef.current >= 3) return;

    const remaining = queue.length - 1 - currentIndex;
    if (remaining > 2) return;

    fetchRadioBatch(queue[currentIndex]?.id ?? null, 15);
  }, [queue, currentIndex, upNextQueue.length, autoplayRadio, repeat, fetchRadioBatch]);

  /** Radio with no seed — replaces the queue entirely. */
  const fetchRadioBatchIntoNewQueue = useCallback(async (): Promise<number> => {
    setRadioLoading(true);
    try {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      if (!res.ok) return 0;
      const data = await res.json();
      const tracks: Track[] = (data?.tracks ?? [])
        .filter((t: any) => t?.id && t?.audioUrl)
        .map((t: any) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          artistId: t.artistId ?? undefined,
          album: t.album ?? undefined,
          albumId: t.albumId ?? undefined,
          coverUrl: t.coverUrl ?? undefined,
          audioUrl: t.audioUrl,
          duration: t.duration ?? 0,
          autoplay: true,
          reason: t.reason,
        }));
      if (tracks.length === 0) return 0;

      setQueueState(tracks);
      setCurrentIndex(0);
      setUpNextQueue([]);
      setIsPlaying(true);
      setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
      return tracks.length;
    } catch {
      return 0;
    } finally {
      setRadioLoading(false);
    }
  }, []);

  /** Explicitly start a radio from a seed track (or from pure taste). */
  const startRadio = useCallback(
    async (seedTrack?: Track) => {
      radioMissesRef.current = 0;
      playContextRef.current = { context: "radio", contextId: seedTrack?.id ?? null };

      if (seedTrack) {
        setQueueState([{ ...seedTrack }]);
        setCurrentIndex(0);
        setUpNextQueue([]);
        setIsPlaying(true);
        setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
        await fetchRadioBatch(seedTrack.id, 20);
        return;
      }

      const added = await fetchRadioBatchIntoNewQueue();
      if (added === 0) showToast("Nothing to play just yet", "error");
    },
    [fetchRadioBatch, fetchRadioBatchIntoNewQueue, showToast]
  );

  const setAutoplayRadio = useCallback((on: boolean) => {
    setAutoplayRadioState(on);
    localStorage.setItem("sakura-player-autoplay-radio", String(on));
    if (on) radioMissesRef.current = 0;
  }, []);

  const setPlayContext = useCallback((ctx: PlayContext) => {
    playContextRef.current = ctx;
  }, []);

  const prev = useCallback(() => {
    const ci = currentIndexRef.current;
    if (progress > 3) {
      if (audioRef.current) {
        try {
          audioRef.current.currentTime = 0;
        } catch {}
      }
      setProgress(0);
    } else if (ci > 0) {
      goToTrack(ci - 1);
    } else {
      const q = queueRef.current;
      if (q.length > 0) {
        goToTrack(q.length - 1);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  }, [progress, goToTrack]);

  // The audio element and its listeners are created exactly once. Handlers
  // read through refs rather than closing over state, so they never go stale.
  const advanceRef = useRef(advance);
  useEffect(() => { advanceRef.current = advance; }, [advance]);

  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.volume = volume;
      audioRef.current = audio;

      audio.addEventListener("timeupdate", () => {
        if (audioRef.current && !seekingRef.current) {
          setProgress(audioRef.current.currentTime);
          setDuration(audioRef.current.duration || 0);
        }
      });

      audio.addEventListener("loadedmetadata", () => {
        const d = audioRef.current?.duration;
        if (d && isFinite(d)) signalTracker.setDuration(d * 1000);
      });

      audio.addEventListener("ended", () => {
        // A completed listen — the single strongest positive taste signal
        // there is. Bank it before the queue moves on.
        signalTracker.endTrack({ natural: true });

        if (repeatRef.current === "one") {
          audioRef.current?.play().catch(() => {});
          return;
        }
        advanceRef.current({ autoplay: true });
      });

      audio.addEventListener("play", () => {
        setIsPlaying(true);
        signalTracker.resume();
      });

      audio.addEventListener("pause", () => {
        setIsPlaying(false);
        signalTracker.pause();
      });

      // Auto-skip on stream playback failure with toast notification.
      audio.addEventListener("error", () => {
        // Only treat this as a real failure if a source was actually set —
        // clearing src or an aborted load fires error too, and skipping the
        // track there would make playback lurch for no reason.
        const el = audioRef.current;
        if (!el || !el.src || el.src === window.location.href) return;

        console.error("Audio playback error for", el.src);
        showToast("Playback failure. Skipping to next track.", "error");
        // Don't record a skip signal: the person didn't reject this track,
        // the stream broke. Counting it would poison their taste profile.
        signalTracker.endTrack({ natural: false, positionMs: 0 });
        advanceRef.current({ autoplay: true });
      });
    }
  }, [showToast]);

  // Hydrate player settings and queue from localStorage on mount
  useEffect(() => {
    try {
      const savedQueue = localStorage.getItem("sakura-player-queue");
      const savedIndex = localStorage.getItem("sakura-player-index");
      const savedProgress = localStorage.getItem("sakura-player-progress");
      const savedVolume = localStorage.getItem("sakura-player-volume");
      const savedShuffle = localStorage.getItem("sakura-player-shuffle");
      const savedRepeat = localStorage.getItem("sakura-player-repeat");
      const savedDownloadQueue = localStorage.getItem("sakura-player-download-queue");

      const savedUpNext = localStorage.getItem("sakura-player-upnext");
      if (savedQueue) setQueueState(JSON.parse(savedQueue));
      if (savedUpNext) setUpNextQueue(JSON.parse(savedUpNext));
      if (savedIndex) setCurrentIndex(Number(savedIndex));
      if (savedProgress) setProgress(Number(savedProgress));
      if (savedVolume) {
        const vol = Number(savedVolume);
        setVolumeState(vol);
        if (audioRef.current) audioRef.current.volume = vol;
      }
      if (savedShuffle) setShuffle(savedShuffle === "true");
      if (savedRepeat) setRepeat(savedRepeat as any);

      // Radio defaults to on — an endless queue is the expected behaviour for
      // a music app, so only an explicit opt-out turns it off.
      const savedAutoplay = localStorage.getItem("sakura-player-autoplay-radio");
      if (savedAutoplay !== null) setAutoplayRadioState(savedAutoplay === "true");

      if (savedDownloadQueue) {
        const parsed = JSON.parse(savedDownloadQueue) as DownloadItem[];
        setDownloadQueue(parsed);
        const states: Record<string, "idle" | "queued" | "downloading" | "completed" | "failed"> = {};
        for (const item of parsed) {
          states[item.id] = "queued";
        }
        setDownloadStates(states);
      }
    } catch (e) {
      console.error("Failed to restore player state:", e);
    }
  }, []);

  // Persist state updates to localStorage.
  //
  // Debounced: `queue` changes on every radio refill (15-20 tracks at a time),
  // every reorder and every skip, and `JSON.stringify` of a long queue on the
  // main thread is not free. 500ms is far below the window in which anyone
  // could lose data — the unload/visibility flush below covers the real
  // "person is leaving" cases.
  useDebouncedStorage("sakura-player-queue", queue);
  useDebouncedStorage("sakura-player-upnext", upNextQueue);
  useDebouncedStorage("sakura-player-download-queue", downloadQueue);

  useEffect(() => {
    localStorage.setItem("sakura-player-index", String(currentIndex));
  }, [currentIndex]);

  useEffect(() => {
    localStorage.setItem("sakura-player-volume", String(volume));
  }, [volume]);

  useEffect(() => {
    localStorage.setItem("sakura-player-shuffle", String(shuffle));
  }, [shuffle]);

  useEffect(() => {
    localStorage.setItem("sakura-player-repeat", repeat);
  }, [repeat]);

  // Remember which track the saved progress belongs to, so a reload only ever
  // resumes a position against the track it was actually saved for.
  useEffect(() => {
    if (currentTrack) {
      localStorage.setItem("sakura-player-track-id", currentTrack.id);
    }
  }, [currentTrack?.id]);

  // Progress saving, throttled to roughly every 3s — `progress` updates on every
  // `timeupdate` tick (several times a second), so writing on every change here
  // would hit localStorage far more often than the "resume where you left off"
  // feature actually needs.
  const PROGRESS_SAVE_INTERVAL_MS = 3000;
  useEffect(() => {
    if (seekingRef.current) return;
    const now = Date.now();
    if (now - lastProgressSaveRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
    lastProgressSaveRef.current = now;
    localStorage.setItem("sakura-player-progress", String(progress));
  }, [progress]);

  // Always flush the latest position on tab-hide and page unload — those are
  // exactly the moments a person is likely to actually leave, so the throttle
  // above shouldn't be allowed to lose up to ~3s of position there. Also flush
  // on pause via the audio element's own "pause" event (reuses the existing
  // isPlaying listener already wired up above) so stopping playback saves
  // immediately rather than waiting for the next throttled tick.
  useEffect(() => {
    function flushProgress() {
      if (audioRef.current) {
        lastProgressSaveRef.current = Date.now();
        localStorage.setItem("sakura-player-progress", String(audioRef.current.currentTime));
      }
    }
    function handleVisibility() {
      if (document.visibilityState === "hidden") flushProgress();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flushProgress);
    window.addEventListener("beforeunload", flushProgress);
    audioRef.current?.addEventListener("pause", flushProgress);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flushProgress);
      window.removeEventListener("beforeunload", flushProgress);
      audioRef.current?.removeEventListener("pause", flushProgress);
    };
  }, []);

  // ── Cross-device continuity ───────────────────────────────────────────────
  //
  // localStorage makes playback survive a reload; this makes it survive a
  // *device*. The server holds one row per user and the rule is last-writer-
  // wins, which is the right model for something a person can only really do
  // in one place at a time.

  // A ref, not a dependency array: the snapshot has to reflect the live values
  // at the moment of a push, but re-registering unload listeners on every
  // progress tick would be absurd.
  const snapshotRef = useRef<PlaybackSnapshot>(null as unknown as PlaybackSnapshot);
  snapshotRef.current = {
    trackId: currentTrack?.id ?? null,
    positionMs: Math.floor(progress * 1000),
    durationMs: Math.floor(duration * 1000),
    isPlaying,
    queue: queue.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverUrl: t.coverUrl,
      duration: t.duration,
    })),
    upNext: upNextQueue.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverUrl: t.coverUrl,
      duration: t.duration,
    })),
    queueIndex: currentIndex,
    shuffle,
    repeat,
    context: playContextRef.current.context,
    contextId: playContextRef.current.contextId,
  };

  // Restore from another device, once, on first load.
  //
  // Runs after the localStorage hydration effect above (declaration order is
  // effect order), so `shouldAdoptRemote` compares against real local state
  // rather than an empty player.
  const remoteRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (remoteRestoreAttemptedRef.current) return;
    remoteRestoreAttemptedRef.current = true;

    let cancelled = false;

    (async () => {
      const remote = await fetchPlaybackState();
      if (cancelled || !remote) return;

      const local = snapshotRef.current;
      if (
        !shouldAdoptRemote(remote, {
          trackId: local.trackId,
          positionMs: local.positionMs,
          isPlaying: local.isPlaying,
        })
      ) {
        return;
      }

      const remoteQueue = Array.isArray(remote.queue) ? remote.queue : [];
      if (remoteQueue.length === 0) return;

      // `audioUrl` is deliberately absent from synced queues (it can be a
      // signed, expiring URL). The load effect already resolves an unresolved
      // track on demand, so an empty string here is the documented "resolve
      // this for me" state rather than a stall.
      const restored: Track[] = remoteQueue.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        coverUrl: t.coverUrl,
        audioUrl: "",
        duration: t.duration ?? 0,
      }));

      setQueueState(restored);
      setUpNextQueue(
        (Array.isArray(remote.upNext) ? remote.upNext : []).map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          coverUrl: t.coverUrl,
          audioUrl: "",
          duration: t.duration ?? 0,
        }))
      );
      setCurrentIndex(
        Math.min(Math.max(0, remote.queueIndex ?? 0), Math.max(0, restored.length - 1))
      );
      setShuffle(!!remote.shuffle);
      setRepeat((remote.repeat as "off" | "one" | "all") ?? "off");

      // Hand the position to the same mechanism a reload uses, so there's one
      // code path that applies a resume seek and it's already been proven to
      // wait for loadedmetadata.
      const seconds = Math.floor((remote.positionMs ?? 0) / 1000);
      localStorage.setItem("sakura-player-progress", String(seconds));
      localStorage.setItem("sakura-player-track-id", remote.trackId!);
      setProgress(seconds);
      hasRestoredProgressRef.current = false;

      showToast("Picked up where you left off", "accent");
    })();

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Push: heartbeat while playing, plus the moments that must not be lost.
  useEffect(() => {
    if (!currentTrack) return;

    const interval = setInterval(() => {
      if (snapshotRef.current.isPlaying) {
        void pushPlaybackState(snapshotRef.current);
      }
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [currentTrack?.id]);

  // Track change and play/pause are the transitions worth syncing immediately —
  // they're exactly when someone is likely to pick up a different device.
  useEffect(() => {
    if (!currentTrack) return;
    void pushPlaybackState(snapshotRef.current, { force: true });
  }, [currentTrack?.id, isPlaying]);

  useEffect(() => {
    // sendBeacon is the only transport guaranteed to survive unload — a normal
    // fetch is cancelled with the document.
    const flushRemote = () => {
      void pushPlaybackState(snapshotRef.current, { force: true, beacon: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushRemote();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushRemote);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushRemote);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    async function loadAudio() {
      if (!audioRef.current || !currentTrack) return;

      // Determine if we should play. Only play if we are changing tracks *after* hydration
      const wasPlaying = isPlayingRef.current;
      let src = currentTrack.audioUrl;

      try {
        const uId = getCachedUserId();
        const dId = getDeviceId();
        const blob = await getAudioBlob(currentTrack.id, uId, dId);
        if (blob && active) {
          objectUrl = URL.createObjectURL(blob);
          src = objectUrl;
        }
      } catch (err) {
        console.error("Offline audio fetch failed, playing default URL", err);
      }

      // Queue rows built from a listing carry an empty audioUrl for anything
      // not yet fetched from Telegram (TrackRow only resolves the track the
      // person actually tapped). Skipping onto one of those used to load an
      // empty src and stall silently. Resolve it here — on demand, once, for
      // whichever track is about to play.
      if (!objectUrl && (!src || src === "pending")) {
        try {
          const res = await fetch("/api/music/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: currentTrack.title,
              artist: currentTrack.artist,
              duration: currentTrack.duration,
              albumId: currentTrack.albumId,
            }),
          });
          const data = await res.json();
          if (!active) return;

          if (data?.audioUrl) {
            src = data.audioUrl;
            // Write the resolved URL (and any corrected id) back into the
            // queue so a replay or a prev/next pass doesn't re-resolve it.
            const resolvedId = data.id || currentTrack.id;
            setQueueState((prev) =>
              prev.map((t) =>
                t.id === currentTrack.id
                  ? { ...t, id: resolvedId, audioUrl: data.audioUrl, coverUrl: data.coverUrl || t.coverUrl }
                  : t
              )
            );
          } else {
            throw new Error(data?.error || "No audio available");
          }
        } catch (err) {
          console.error("Failed to resolve audio for queued track:", err);
          if (!active) return;
          showToast("Couldn't load that track. Skipping.", "error");
          advanceRef.current({ autoplay: wasPlaying });
          return;
        }
      }

      if (!active) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }

      // Guard: if this exact track is already loaded (e.g. an effect re-run that
      // didn't actually change tracks), skip the reload entirely — calling
      // `.load()` on an already-current src is what snaps playback back to 0.
      const resolvedSrc = new URL(src, window.location.href).href;
      if (loadedTrackIdRef.current === currentTrack.id && audioRef.current.src === resolvedSrc) {
        return;
      }
      loadedTrackIdRef.current = currentTrack.id;

      // Resolve this ONCE, before mutating audioRef.current.src — it must reflect
      // "has the whole session already restored its saved position", not
      // "is this the first time *this specific track* is loading". That
      // distinction is what previously broke normal next/prev: since the flag
      // used to be a local variable re-created on every effect run, skipping
      // tracks mid-session kept re-triggering the "restore saved position"
      // branch instead of resuming playback on the new track.
      const isFirstLoadThisSession = !hasRestoredProgressRef.current;
      hasRestoredProgressRef.current = true;

      audioRef.current.src = src;
      audioRef.current.load();

      if (isFirstLoadThisSession) {
        // Only resume a saved position if it was actually saved against this
        // same track — otherwise a stale/mismatched value could seek a
        // freshly-picked track to a meaningless timestamp.
        const savedProgress = localStorage.getItem("sakura-player-progress");
        const savedTrackId = localStorage.getItem("sakura-player-track-id");
        if (savedProgress && savedTrackId === currentTrack.id) {
          const time = Number(savedProgress);
          const applySavedSeek = () => {
            if (!audioRef.current) return;
            // Clamp to duration in case of a stale value longer than the track.
            const dur = audioRef.current.duration;
            const clamped = isFinite(dur) && dur > 0 ? Math.min(time, dur) : time;
            audioRef.current.currentTime = clamped;
            setProgress(clamped);
          };
          // Setting currentTime immediately after .load() is unreliable across
          // browsers (metadata isn't guaranteed to be ready yet) — wait for
          // loadedmetadata so the seek reliably lands instead of silently
          // getting dropped.
          if (audioRef.current.readyState >= 1 /* HAVE_METADATA */) {
            applySavedSeek();
          } else {
            audioRef.current.addEventListener("loadedmetadata", applySavedSeek, { once: true });
          }
        }
        // Deliberately no autoplay here even if a saved "was playing" flag existed —
        // browsers block unprompted autoplay, so we just leave playback cued up
        // at the right spot for the person to hit play.
      } else if (wasPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }

    loadAudio();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentTrack?.id]);

  const play = useCallback((track: Track, newQueue?: Track[]) => {
    setProgress(0);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {}
    }
    setIsPlaying(true);

    if (currentTrack && currentTrack.id === track.id) {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    }

    if (newQueue) {
      setQueueState(newQueue);
      const idx = newQueue.findIndex((t) => t.id === track.id);
      setCurrentIndex(idx >= 0 ? idx : 0);
    } else {
      setQueueState((prev) => {
        const existingIdx = prev.findIndex((t) => t.id === track.id);
        if (existingIdx >= 0) {
          setCurrentIndex(existingIdx);
          return prev;
        }
        const newQ = [...prev];
        const insertAt = currentIndexRef.current + 1;
        newQ.splice(insertAt, 0, track);
        setCurrentIndex(insertAt);
        return newQ;
      });
    }
  }, []);

  const playNext = useCallback((track: Track) => {
    setUpNextQueue((prev) => [track, ...prev]);
  }, []);

  const addToQueue = useCallback((track: Track) => {
    setUpNextQueue((prev) => [...prev, track]);
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlayingRef.current) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  }, []);

  const beginSeek = useCallback(() => {
    seekingRef.current = true;
    setIsSeeking(true);
  }, []);

  const endSeek = useCallback((time?: number) => {
    if (audioRef.current && time !== undefined) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
    // Small delay to ensure the audio has processed the seek before allowing timeupdate to update
    setTimeout(() => {
      seekingRef.current = false;
      setIsSeeking(false);
    }, 50);
  }, []);

  // One-shot seek helper for anything that isn't a drag gesture (tapping a lyric line,
  // tapping a queue row's timestamp, etc). Wrapping begin/end around it keeps the
  // `timeupdate` listener from racing a stale currentTime against the new one.
  const seekTo = useCallback(
    (time: number) => {
      seekingRef.current = true;
      setIsSeeking(true);
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        setProgress(time);
      }
      setTimeout(() => {
        seekingRef.current = false;
        setIsSeeking(false);
      }, 50);
    },
    []
  );

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);

  const toggleRepeat = useCallback(() => {
    setRepeat((r) => {
      if (r === "off") return "all";
      if (r === "all") return "one";
      return "off";
    });
  }, []);

  const setQueue = useCallback((tracks: Track[], startIndex = 0) => {
    setQueueState(tracks);
    setCurrentIndex(startIndex);
    setUpNextQueue([]);
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    setQueueState((prev) => {
      const idx = prev.findIndex((t) => t.id === trackId);
      if (idx === -1) return prev;
      const newQ = [...prev];
      newQ.splice(idx, 1);
      if (idx < currentIndexRef.current) {
        setCurrentIndex((i) => i - 1);
      } else if (idx === currentIndexRef.current) {
        if (newQ.length === 0) {
          setCurrentIndex(0);
          setIsPlaying(false);
        } else if (currentIndexRef.current >= newQ.length) {
          setCurrentIndex(newQ.length - 1);
        }
      }
      return newQ;
    });
  }, []);

  const removeTracks = useCallback((trackIds: string[]) => {
    const idsSet = new Set(trackIds);
    setQueueState((prev) => {
      const currentTrack = prev[currentIndexRef.current];
      const newQ = prev.filter((t) => !idsSet.has(t.id));
      const newIdx = newQ.findIndex((t) => t.id === currentTrack?.id);
      if (newIdx >= 0) {
        setCurrentIndex(newIdx);
      } else if (newQ.length === 0) {
        setCurrentIndex(0);
        setIsPlaying(false);
      } else {
        setCurrentIndex(Math.min(currentIndexRef.current, newQ.length - 1));
      }
      return newQ;
    });
  }, []);

  const removeFromUpNext = useCallback((trackId: string) => {
    setUpNextQueue((prev) => prev.filter((t) => t.id !== trackId));
  }, []);

  const reorderUpNext = useCallback((fromIndex: number, toIndex: number) => {
    setUpNextQueue((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const arr = [...prev];
      const [item] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, item);
      return arr;
    });
  }, []);

  // fromIndex/toIndex here are relative to the "rest of queue" slice (after currentIndex)
  const reorderQueueTail = useCallback((fromIndex: number, toIndex: number) => {
    setQueueState((prev) => {
      const base = currentIndexRef.current + 1;
      const from = base + fromIndex;
      const to = base + toIndex;
      if (from === to || from < base || to < base || from >= prev.length || to >= prev.length) return prev;
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  }, []);

  const reshuffleQueue = useCallback(() => {
    setQueueState((prev) => {
      if (prev.length <= 1) return prev;
      const currentTrack = prev[currentIndexRef.current];
      const withoutCurrent = prev.filter((_, i) => i !== currentIndexRef.current);
      const shuffled = [...withoutCurrent];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return [currentTrack, ...shuffled];
    });
    setCurrentIndex(0);
  }, []);



  // NOTE: queue/upNextQueue/currentIndex/volume/progress are already persisted
  // and restored individually above (the "sakura-player-*" keys, hydrated in
  // the mount effect near the top of this file). A second, separate
  // "sakura-player" combined-blob save/restore used to live here, writing the
  // same data under a different key on a different schedule — the two could
  // drift out of sync (e.g. `queue` saved on every queue change, but this
  // blob only on queue+upNextQueue+currentIndex+volume all together), and
  // since this restore effect ran *after* the individual-key one, it could
  // silently overwrite a correctly-restored currentIndex/queue with stale
  // data. Removed in favor of the single individual-key system.

  // Memoised so the provider doesn't hand every consumer a brand-new object
  // on each render. `progress` updates several times a second during
  // playback, and without this every component reading *any* part of the
  // context (each row in a long track list, the tab bar, the mini player)
  // re-rendered on every tick.
  //
  // The dependency list is exhaustive on purpose: all the callbacks are
  // useCallback-stable, so in practice this only rebuilds when real state
  // changes.
  const contextValue = useMemo<PlayerContextType>(
    () => ({
      queue,
      upNextQueue,
      currentIndex,
      currentTrack,
      isPlaying,
      isSeeking,
      progress,
      duration,
      volume,
      shuffle,
      repeat,
      play,
      playNext,
      addToQueue,
      togglePlay,
      seek,
      beginSeek,
      endSeek,
      seekTo,
      lyrics,
      loadingLyrics,
      activeLyricIndex,
      activeLyricLine,
      setVolume,
      next,
      prev,
      toggleShuffle,
      toggleRepeat,
      setQueue,
      goToQueueItem,
      removeTrack,
      removeTracks,
      reshuffleQueue,
      isLiked,
      toggleLiked,
      favoriteTrackIds,
      toggleLikeTrack,
      accentColor,
      miniArtRect,
      setMiniArtRect,
      removeFromUpNext,
      reorderUpNext,
      reorderQueueTail,
      toast,
      showToast,
      hideToast,
      sleepTimerMinutes,
      setSleepTimer,
      autoplayRadio,
      setAutoplayRadio,
      radioLoading,
      startRadio,
      setPlayContext,
      downloadQueue,
      downloadStates,
      downloadProgress,
      downloadSpeed,
      addToDownloadQueue,
      removeFromDownloadQueue,
    }),
    [
      queue, upNextQueue, currentIndex, currentTrack, isPlaying, isSeeking,
      progress, duration, volume, shuffle, repeat, play, playNext, addToQueue,
      togglePlay, seek, beginSeek, endSeek, seekTo, lyrics, loadingLyrics,
      activeLyricIndex, activeLyricLine, setVolume, next, prev, toggleShuffle,
      toggleRepeat, setQueue, goToQueueItem, removeTrack, removeTracks,
      reshuffleQueue, isLiked, toggleLiked, favoriteTrackIds, toggleLikeTrack,
      accentColor, miniArtRect, removeFromUpNext, reorderUpNext,
      reorderQueueTail, toast, showToast, hideToast, sleepTimerMinutes,
      setSleepTimer, autoplayRadio, setAutoplayRadio, radioLoading, startRadio,
      setPlayContext, downloadQueue, downloadStates, downloadProgress,
      downloadSpeed, addToDownloadQueue, removeFromDownloadQueue,
    ]
  );

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          visible={toast.visible}
          onClose={hideToast}
        />
      )}
      <div aria-live="polite" aria-atomic="true" className="srOnly">
        {announcement}
      </div>
    </PlayerContext.Provider>
  );
}
