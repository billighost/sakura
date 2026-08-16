"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getAudioBlob, getCachedUserId, getDeviceId, isTrackDownloaded, saveTrackOffline, saveAudioBlob, findDownloadedTrackByMetadata, cloneDownloadedTrack, getPartialAudio, savePartialAudio, removePartialAudio } from "@/lib/offline-db";
import { extractDominantColor } from "@/lib/color";
import { getLyrics, LyricData } from "@/lib/lyrics";
import { signalTracker } from "@/lib/signals";
import { recordSignal as recordInstallSignal } from "@/lib/installPrompt";
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
  /**
   * The real DB id, once a virtual/pending track has been resolved.
   *
   * Kept separate from `id` on purpose. Overwriting `id` in place (which is
   * what used to happen) changes the key the load effect is subscribed to, so
   * the effect re-runs, the "already loaded" guard misses, and playback
   * restarts — and if the resolved id already existed elsewhere in the queue
   * you end up with two entries sharing an id, which makes every findIndex
   * lookup ambiguous. Anything that needs the canonical id reads
   * `resolvedId ?? id`.
   */
  resolvedId?: string;
}

/** The id to report to the server for a track: canonical if known. */
function canonicalId(track: Track): string {
  return track.resolvedId ?? track.id;
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
  play: (track: Track, queue?: Track[], targetIndex?: number) => void;
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

/** localStorage keys for the "resume where you left off" pair. */
const PROGRESS_KEY = "sakura-player-progress";
const PROGRESS_TRACK_KEY = "sakura-player-track-id";

/**
 * Read the persisted resume point.
 *
 * Returns a position of 0 rather than null on a miss so callers always have a
 * concrete pair to compare against the track that ends up loading — the
 * position is only ever applied when `trackId` matches, so a missing entry is
 * indistinguishable from "belongs to some other track" and needs no special
 * case at the call site.
 */
function readSavedResumePoint(): { positionSec: number; trackId: string | null } {
  if (typeof window === "undefined") return { positionSec: 0, trackId: null };
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const position = Number(raw);
    return {
      positionSec: Number.isFinite(position) && position > 0 ? position : 0,
      trackId: localStorage.getItem(PROGRESS_TRACK_KEY),
    };
  } catch {
    return { positionSec: 0, trackId: null };
  }
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
  /**
   * The persisted resume point, snapshotted during the first render.
   *
   * This has to be read here — synchronously, before any effect runs — rather
   * than out of localStorage at the point of use. `lastProgressSaveRef` starts
   * at 0, so on the first commit the throttled progress saver below sees
   * `Date.now() - 0` as "long enough" and writes the initial `progress` of 0
   * straight over the stored value. That happened before the load effect ever
   * got to read it, so the track was restored but always from the beginning —
   * the position half of "resume where you left off" was destroyed by the code
   * meant to persist it.
   *
   * Snapshotting at init makes the resume point immune to that ordering
   * entirely: whatever the writers do afterwards, the value the load effect
   * consumes is the one that was on disk when the page opened.
   */
  const savedResumeRef = useRef<{ positionSec: number; trackId: string | null } | undefined>(
    undefined
  );
  if (savedResumeRef.current === undefined) {
    savedResumeRef.current = readSavedResumePoint();
  }
  /**
   * False until the resume point has been consumed (applied to the audio
   * element, or discarded because it didn't belong to the loaded track).
   *
   * Gates every progress writer. Without it the writers race the restore and
   * can persist a position of 0 for a track that is about to be seeked, which
   * loses the resume point for the *next* reload even when this one worked.
   */
  const resumeSettledRef = useRef(false);
  // When a remote-sync restore sets a seek target for the current track, we
  // can't go through loadAudio (the track ID hasn't changed, so that effect
  // won't re-run). This ref lets the seek happen directly on the audio element,
  // either immediately or on the next loadedmetadata event.
  const pendingSeekMsRef = useRef<number | null>(null);
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
  const [remoteSyncDone, setRemoteSyncDone] = useState(false);

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
              // Exact cache key. Without it the server can only match on
              // title+artist strings, which miss whenever the bot's own
              // metadata differs from Deezer's, forcing a fresh download of a
              // file we already have in the chat.
              deezerId: finalId.startsWith("deezer-") ? finalId.slice(7) : undefined,
            }),
          });
          const data = await res.json();
          if (data.error || !data.audioUrl) throw new Error(data.error || "Auto-download failed");

          finalAudioUrl = data.audioUrl;
          finalId = data.id;
          finalCoverUrl = data.coverUrl || finalCoverUrl;
        }

        let chunks: BlobPart[] = [];
        let bytesLoaded = 0;
        
        const partial = await getPartialAudio(finalId, uId, dId);
        if (partial) {
          chunks = partial.chunks;
          bytesLoaded = partial.downloadedBytes;
        }

        const headers = new Headers();
        if (bytesLoaded > 0) {
          headers.set("Range", `bytes=${bytesLoaded}-`);
        }

        // BUG-3 FIX: Never mutate a Response — it's sealed in modern runtimes.
        // Instead, pick the right fetch response and use it directly.
        let activeRes: Response;
        if (bytesLoaded > 0) {
          // Attempt a range request first.
          const rangeRes = await fetch(finalAudioUrl!, { headers });
          if (rangeRes.status === 206) {
            // Partial content — resume download from where we left off.
            activeRes = rangeRes;
          } else if (rangeRes.status === 416 || rangeRes.status === 200) {
            // 416: range not satisfiable (file changed/shorter than saved offset).
            // 200: server ignored the Range header and returned the whole file.
            // In both cases discard our partial data and start fresh.
            chunks = [];
            bytesLoaded = 0;
            if (rangeRes.status === 200) {
              activeRes = rangeRes;
            } else {
              // Re-fetch without a Range header.
              const freshRes = await fetch(finalAudioUrl!);
              if (!freshRes.ok) throw new Error(`Failed to fetch audio stream: ${freshRes.status}`);
              activeRes = freshRes;
            }
          } else {
            throw new Error(`Failed to fetch audio stream: ${rangeRes.status}`);
          }
        } else {
          // No partial data — plain fetch.
          const plainRes = await fetch(finalAudioUrl!);
          if (!plainRes.ok) throw new Error(`Failed to fetch audio stream: ${plainRes.status}`);
          activeRes = plainRes;
        }

        const contentLengthHeader = activeRes.headers.get("content-length");
        const contentRangeHeader = activeRes.headers.get("content-range");
        let totalBytes = 0;
        if (contentRangeHeader) {
          const match = contentRangeHeader.match(/\/(\d+)$/);
          if (match) totalBytes = parseInt(match[1], 10);
        } else if (contentLengthHeader) {
          totalBytes = parseInt(contentLengthHeader, 10);
        }

        const reader = activeRes.body!.getReader();
        const startTime = Date.now();
        let lastSaveTime = Date.now();

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

          // Save partial progress every 1s
          if (Date.now() - lastSaveTime > 1000) {
             await savePartialAudio(finalId, chunks as Blob[], totalBytes, bytesLoaded, uId, dId);
             lastSaveTime = Date.now();
          }
        }

        const blob = new Blob(chunks, { type: activeRes.headers.get("content-type") || "audio/mpeg" });

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
        await removePartialAudio(finalId, uId, dId);

        /**
         * A Deezer-sourced track finishes under a different id than the one that
         * was queued: `item.id` is `deezer-<id>`, and `finalId` is the real row
         * the Telegram download created. The rows in the UI and the entries in
         * the play queue still hold the queued id, so it has to resolve too or
         * the track reads as never downloaded and is fetched again on next play.
         *
         * The metadata row is written under the queued id, with `blobId`
         * pointing at where the audio really is. `getAudioBlob` follows that on
         * a miss. Writing the blob itself twice would also work and is what this
         * did first, but it doubles on-device storage for every Deezer-sourced
         * download — a 50-track playlist would cost ~500 MB instead of ~250 MB.
         */
        if (finalId !== item.id) {
          await saveTrackOffline({
            id: item.id,
            title: item.title,
            artist: item.artist,
            album: item.album,
            audioUrl: finalAudioUrl!,
            coverUrl: finalCoverUrl,
            duration: item.duration,
            blobId: finalId,
          }, uId, dId);
        }

        setDownloadStates((prev) => ({ ...prev, [item.id]: "completed", [finalId]: "completed" }));

        // A finished download is the best moment in the app to offer an
        // install — see lib/installPrompt.ts for the reasoning.
        recordInstallSignal("download");
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
  const isLiked = currentTrack
    ? favoriteTrackIds.has(canonicalId(currentTrack)) || favoriteTrackIds.has(currentTrack.id)
    : false;

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

  /*
   * Load the set of liked track ids.
   *
   * The status check is the point. `fetch` doesn't throw on 4xx, so a 401 from an
   * expired session parsed as `{ error: "Unauthorized" }` — not an array, no
   * `.tracks` — and silently produced an empty set. Every heart in the app then
   * rendered as unliked, and tapping one issued a POST that also 401'd and
   * reverted, so the like button appeared to be broken rather than the session.
   *
   * There's still nothing to *show* the user here (this runs before any screen
   * has an opinion about it), but a console error is the difference between a
   * five-minute diagnosis and an hour of one.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/favorites");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: unknown = await res.json();
        const list: { id?: unknown }[] = Array.isArray(data)
          ? data
          : Array.isArray((data as { tracks?: unknown })?.tracks)
            ? ((data as { tracks: { id?: unknown }[] }).tracks)
            : [];
        const ids = list
          .map((t) => t.id)
          .filter((id): id is string => typeof id === "string");
        if (!cancelled) setFavoriteTrackIds(new Set(ids));
      } catch (err) {
        if (!cancelled) console.error("Couldn't load liked songs", err);
      }
    })();

    return () => {
      cancelled = true;
    };
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

    const revert = () => {
      setFavoriteTrackIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) {
          next.add(trackId);
        } else {
          next.delete(trackId);
        }
        return next;
      });
    };

    try {
      let res: Response;
      if (wasLiked) {
        res = await fetch(`/api/favorites/${trackId}`, { method: "DELETE" });
      } else {
        res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId }),
        });
      }
      // fetch() doesn't throw on 4xx/5xx — check the status explicitly
      // so the optimistic update is reverted if the server rejected the request.
      if (!res.ok) {
        console.error("Failed to toggle liked state: HTTP", res.status);
        revert();
      }
    } catch (err) {
      console.error("Failed to toggle liked state", err);
      revert();
    }
  }, [favoriteTrackIds]);

  const toggleLiked = useCallback(() => {
    if (currentTrack) {
      // Canonical id: liking a not-yet-resolved track would otherwise write a
      // favourite against an id that has no row.
      toggleLikeTrack(canonicalId(currentTrack));
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
          // A radio pick may be a virtual candidate with no audioUrl yet — it
          // resolves on play. Requiring audioUrl here silently discarded the
          // entire catalogue-backed half of the batch.
          .filter((t: any) => t?.id && (t.audioUrl || t.id.startsWith("deezer-")))
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
      //
      // Computed outside the updaters for the same reason as play/removeTrack:
      // the spliced queue and the incremented index must be derived from one
      // and the same `prev`, or they can disagree and the player loads a
      // different track than the one the UI is showing.
      const uq = upNextRef.current;
      if (uq.length > 0) {
        const nextTrack = uq[0];
        const prevQueue = queueRef.current;
        const insertAt = Math.min(currentIndexRef.current + 1, prevQueue.length);
        const nextQueue = [...prevQueue];
        nextQueue.splice(insertAt, 0, nextTrack);

        setUpNextQueue((prev) => prev.slice(1));
        setQueueState(nextQueue);
        setCurrentIndex(insertAt);
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
    // Signals must carry the canonical id — a `deezer-` virtual id has no row
    // to attach taste data to, so reporting it would silently drop the signal.
    signalTracker.beginTrack(canonicalId(currentTrack), (currentTrack.duration || 0) * 1000, {
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
        // Same as the continuation path: virtual picks carry no audioUrl until
        // they're resolved, so they must survive this filter.
        .filter((t: any) => t?.id && (t.audioUrl || t.id.startsWith("deezer-")))
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

        // Apply a cross-device seek that arrived before the audio was ready.
        if (pendingSeekMsRef.current !== null && audioRef.current) {
          const targetSec = pendingSeekMsRef.current / 1000;
          const dur = audioRef.current.duration;
          const clamped = isFinite(dur) && dur > 0 ? Math.min(targetSec, dur) : targetSec;
          audioRef.current.currentTime = clamped;
          setProgress(clamped);
          pendingSeekMsRef.current = null;
          resumeSettledRef.current = true;
        }
      });

      audio.addEventListener("ended", () => {
        // A completed listen — the single strongest positive taste signal
        // there is. Bank it before the queue moves on.
        signalTracker.endTrack({ natural: true });
        recordInstallSignal("play");

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
      //
      // Two classes of false-positive must be silenced:
      //  1. MEDIA_ERR_ABORTED: fires when the player sets a new src and the
      //     browser cancels the previous fetch. This is a normal skip, not an
      //     error — advancing again would double-skip.
      //  2. Rapid re-fires: if the new src also fails (e.g. during a cascade),
      //     the 2-second gate keeps us from skipping through the whole queue
      //     before the Telegram client has time to recover.
      let lastErrorSkipMs = 0;
      audio.addEventListener("error", () => {
        const el = audioRef.current;
        if (!el || !el.src || el.src === window.location.href) return;

        // Ignore aborts — these fire during intentional track changes.
        if (el.error?.code === MediaError.MEDIA_ERR_ABORTED) return;

        // Debounce: suppress if we already skipped within the last 2 seconds.
        const now = Date.now();
        if (now - lastErrorSkipMs < 2000) return;
        lastErrorSkipMs = now;

        console.error("Audio playback error for", el.src, "code:", el.error?.code);
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
      localStorage.setItem(PROGRESS_TRACK_KEY, currentTrack.id);
    }
  }, [currentTrack?.id]);

  // Progress saving, throttled to roughly every 3s — `progress` updates on every
  // `timeupdate` tick (several times a second), so writing on every change here
  // would hit localStorage far more often than the "resume where you left off"
  // feature actually needs.
  const PROGRESS_SAVE_INTERVAL_MS = 3000;
  useEffect(() => {
    if (seekingRef.current) return;
    // Until the resume point has been consumed, writing here would overwrite it
    // with the player's pre-restore position (0 on a fresh load) and destroy the
    // very thing the load effect is about to read.
    if (!resumeSettledRef.current) return;
    const now = Date.now();
    if (now - lastProgressSaveRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
    lastProgressSaveRef.current = now;
    localStorage.setItem(PROGRESS_KEY, String(progress));
  }, [progress]);

  // Always flush the latest position on tab-hide and page unload — those are
  // exactly the moments a person is likely to actually leave, so the throttle
  // above shouldn't be allowed to lose up to ~3s of position there. Also flush
  // on pause via the audio element's own "pause" event (reuses the existing
  // isPlaying listener already wired up above) so stopping playback saves
  // immediately rather than waiting for the next throttled tick.
  useEffect(() => {
    function flushProgress() {
      // Same guard as the throttled saver: before the restore lands, the
      // element still reads 0 and flushing that loses the resume point.
      if (!resumeSettledRef.current) return;
      if (audioRef.current) {
        lastProgressSaveRef.current = Date.now();
        localStorage.setItem(PROGRESS_KEY, String(audioRef.current.currentTime));
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
    trackId: currentTrack ? canonicalId(currentTrack) : null,
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
      try {
        // BUG-2 FIX: Race the network call against a 5-second timeout.
        // If fetchPlaybackState() hangs (slow server, no connection), we must
        // still set remoteSyncDone so play() and togglePlay() become usable.
        const remote = await Promise.race([
          fetchPlaybackState(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
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

        // If the remote track is the same one already loaded, seek directly —
        // loadAudio won't re-run because the track ID hasn't changed, and the
        // "already loaded" guard inside loadAudio would early-return anyway.
        const targetSec = (remote.positionMs ?? 0) / 1000;

        const applySeek = () => {
          if (!audioRef.current) return;
          const dur = audioRef.current.duration;
          const clamped = isFinite(dur) && dur > 0 ? Math.min(targetSec, dur) : targetSec;
          audioRef.current.currentTime = clamped;
          setProgress(clamped);
          pendingSeekMsRef.current = null;
          // The element now holds the adopted position, so the progress savers
          // are free to persist it.
          resumeSettledRef.current = true;
        };

        if (remote.trackId === snapshotRef.current.trackId) {
          // Same track — seek now if audio is ready, else queue it.
          if (audioRef.current && audioRef.current.readyState >= 1) {
            applySeek();
          } else {
            pendingSeekMsRef.current = remote.positionMs ?? 0;
          }
          // Also update the snapshot and localStorage so a future reload
          // resumes at this position. The snapshot is what the load effect
          // actually consults, so updating only localStorage would leave a
          // remote restore invisible to it.
          savedResumeRef.current = { positionSec: targetSec, trackId: remote.trackId! };
          localStorage.setItem(PROGRESS_KEY, String(targetSec));
          localStorage.setItem(PROGRESS_TRACK_KEY, remote.trackId!);
          setProgress(targetSec);
        } else {
          // Different track — loadAudio will run when currentIndex/currentTrack
          // changes. Funnel the position through the snapshot + the flag so the
          // existing loadedmetadata path in loadAudio applies it.
          savedResumeRef.current = { positionSec: targetSec, trackId: remote.trackId! };
          localStorage.setItem(PROGRESS_KEY, String(targetSec));
          localStorage.setItem(PROGRESS_TRACK_KEY, remote.trackId!);
          setProgress(targetSec);
          hasRestoredProgressRef.current = false;
          // Re-arm the writer guard: the adopted position hasn't been applied
          // to the element yet, so letting the savers run would persist the
          // outgoing track's position against the incoming track's id.
          resumeSettledRef.current = false;
        }

        showToast("Picked up where you left off", "accent");
      } finally {
        // Always unblock the player — even if the sync failed or timed out.
        if (!cancelled) setRemoteSyncDone(true);
      }
    })();

    // Unconditional safety valve: if the IIFE somehow never resolves the
    // finally (e.g. an uncaught exception before the try block), unblock
    // after 6 seconds so the player doesn't stay frozen indefinitely.
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setRemoteSyncDone(true);
    }, 6000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      remoteRestoreAttemptedRef.current = false;
    };
  }, [showToast]);

  // Push: heartbeat while playing, plus the moments that must not be lost.
  useEffect(() => {
    if (!currentTrack || !remoteSyncDone) return;

    const interval = setInterval(() => {
      if (snapshotRef.current.isPlaying) {
        void pushPlaybackState(snapshotRef.current);
      }
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [currentTrack?.id, remoteSyncDone]);

  // Track change and play/pause are the transitions worth syncing immediately —
  // they're exactly when someone is likely to pick up a different device.
  useEffect(() => {
    if (!currentTrack || !remoteSyncDone) return;
    void pushPlaybackState(snapshotRef.current, { force: true });
  }, [currentTrack?.id, isPlaying, remoteSyncDone]);

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
      const au = src || "";
      const isAudioUsable = au.startsWith("/api/stream/telegram/") && !au.endsWith("/0");

      if (!objectUrl && !isAudioUsable) {
        try {
          const res = await fetch("/api/music/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: currentTrack.title,
              artist: currentTrack.artist,
              duration: currentTrack.duration,
              albumId: currentTrack.albumId,
              deezerId: currentTrack.id.startsWith("deezer-")
                ? currentTrack.id.slice(7)
                : undefined,
            }),
          });
          const data = await res.json();
          if (!active) return;

          if (data?.audioUrl) {
            src = data.audioUrl;
            // Write the resolved URL back into the queue so a replay or a
            // prev/next pass doesn't re-resolve it. The canonical id goes in
            // `resolvedId`, never over `id` — see the Track type for why
            // mutating `id` here restarted playback and could duplicate keys.
            setQueueState((prev) =>
              prev.map((t) =>
                t.id === currentTrack.id ||
                (currentTrack.resolvedId && (t.id === currentTrack.resolvedId || t.resolvedId === currentTrack.resolvedId))
                  ? {
                      ...t,
                      resolvedId: data.id || t.resolvedId,
                      audioUrl: data.audioUrl,
                      coverUrl: data.coverUrl || t.coverUrl,
                    }
                  : t
              )
            );
          } else {
            throw new Error(data?.error || "No audio available");
          }
        } catch (err) {
          console.error("Failed to resolve audio for queued track:", err);
          if (!active) return;
          showToast("Couldn't load that track — download failed. Skipping.", "error");
          // Add a small delay before skipping to prevent a rapid-fire cascade
          // where every track in the queue fails instantly and the player races
          // through them all in under a second.
          await new Promise((r) => setTimeout(r, 1500));
          if (!active) return;
          advanceRef.current({ autoplay: isPlayingRef.current });
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
        //
        // The resume point comes from the render-time snapshot, not from
        // localStorage: by the time this runs the throttled saver has already
        // had a chance to overwrite the stored value with the player's initial
        // 0. See `savedResumeRef` for the full story.
        const saved = savedResumeRef.current ?? { positionSec: 0, trackId: null };
        const savedTrackId = saved.trackId;
        const trackMatches =
          savedTrackId === currentTrack.id ||
          (currentTrack.resolvedId && savedTrackId === currentTrack.resolvedId);
        if (saved.positionSec > 0 && trackMatches) {
          const time = saved.positionSec;
          const applySavedSeek = () => {
            if (!audioRef.current) return;
            // Clamp to duration in case of a stale value longer than the track.
            const dur = audioRef.current.duration;
            const clamped = isFinite(dur) && dur > 0 ? Math.min(time, dur) : time;
            audioRef.current.currentTime = clamped;
            setProgress(clamped);
            // Only now is it safe to let the writers run again: the element is
            // at the resumed position, so anything they persist is real.
            resumeSettledRef.current = true;
          };
          // Setting currentTime immediately after .load() is unreliable across
          // browsers (metadata isn't guaranteed to be ready yet) — wait for
          // loadedmetadata so the seek reliably lands instead of silently
          // getting dropped.
          if (audioRef.current.readyState >= 1 /* HAVE_METADATA */) {
            applySavedSeek();
          } else {
            audioRef.current.addEventListener("loadedmetadata", applySavedSeek, { once: true });
            // Belt-and-braces: if `loadedmetadata` never fires (a src that
            // fails to load, a browser that already had metadata and won't
            // re-emit), the writers would stay frozen for the whole session and
            // no position would ever be saved again. Release them on a timer.
            setTimeout(() => {
              resumeSettledRef.current = true;
            }, 10_000);
          }
        } else {
          // Nothing to resume for this track — the writers can run immediately.
          resumeSettledRef.current = true;
        }
        // at the right spot for the person to hit play.
      }
      if (isPlayingRef.current) {
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

  const play = useCallback((track: Track, newQueue?: Track[], targetIndex?: number) => {
    if (!remoteSyncDone) return;
    setProgress(0);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = 0;
      } catch {}
    }
    setIsPlaying(true);

    if (currentTrack && (currentTrack.id === track.id || (track.resolvedId && currentTrack.id === track.resolvedId))) {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    }

    if (newQueue && newQueue.length > 0) {
      let idx = -1;

      // 1. Try exact targetIndex if provided and valid
      if (targetIndex !== undefined && targetIndex >= 0 && targetIndex < newQueue.length) {
        const candidate = newQueue[targetIndex];
        if (
          candidate.id === track.id ||
          candidate.id === track.resolvedId ||
          (track.resolvedId && candidate.id === track.resolvedId) ||
          (candidate.title.toLowerCase() === track.title.toLowerCase() &&
            candidate.artist.toLowerCase() === track.artist.toLowerCase())
        ) {
          idx = targetIndex;
        }
      }

      // 2. Search newQueue by id, resolvedId, or title+artist
      if (idx === -1) {
        idx = newQueue.findIndex(
          (t) =>
            t.id === track.id ||
            t.id === track.resolvedId ||
            (track.resolvedId && t.id === track.resolvedId) ||
            (t.resolvedId && (t.resolvedId === track.id || t.resolvedId === track.resolvedId)) ||
            (t.title.toLowerCase() === track.title.toLowerCase() &&
              t.artist.toLowerCase() === track.artist.toLowerCase())
        );
      }

      // 3. Fallback to targetIndex if provided and valid, otherwise 0
      if (idx === -1) {
        if (targetIndex !== undefined && targetIndex >= 0 && targetIndex < newQueue.length) {
          idx = targetIndex;
        } else {
          idx = 0;
        }
      }

      // Update the queue entry at idx with resolved audioUrl & resolvedId if track has them
      const updatedQueue = [...newQueue];
      updatedQueue[idx] = {
        ...updatedQueue[idx],
        audioUrl: track.audioUrl || updatedQueue[idx].audioUrl,
        resolvedId: track.resolvedId || updatedQueue[idx].resolvedId || updatedQueue[idx].id,
        coverUrl: track.coverUrl || updatedQueue[idx].coverUrl,
      };

      setQueueState(updatedQueue);
      setCurrentIndex(idx);
      return;
    }

    const prevQueue = queueRef.current;
    const existingIdx = prevQueue.findIndex(
      (t) =>
        t.id === track.id ||
        t.id === track.resolvedId ||
        (track.resolvedId && t.id === track.resolvedId) ||
        (t.resolvedId && (t.resolvedId === track.id || t.resolvedId === track.resolvedId)) ||
        (t.title.toLowerCase() === track.title.toLowerCase() &&
          t.artist.toLowerCase() === track.artist.toLowerCase())
    );

    if (existingIdx >= 0) {
      setQueueState((prev) =>
        prev.map((t, i) =>
          i === existingIdx
            ? {
                ...t,
                audioUrl: track.audioUrl || t.audioUrl,
                resolvedId: track.resolvedId || t.resolvedId,
                coverUrl: track.coverUrl || t.coverUrl,
              }
            : t
        )
      );
      setCurrentIndex(existingIdx);
      return;
    }

    const insertAt = Math.min(currentIndexRef.current + 1, prevQueue.length);
    const nextQueue = [...prevQueue];
    nextQueue.splice(insertAt, 0, track);
    setQueueState(nextQueue);
    setCurrentIndex(insertAt);
  }, [remoteSyncDone]);

  const playNext = useCallback((track: Track) => {
    setUpNextQueue((prev) => [track, ...prev]);
  }, []);

  const addToQueue = useCallback((track: Track) => {
    setUpNextQueue((prev) => [...prev, track]);
  }, []);

  const togglePlay = useCallback(() => {
    if (!remoteSyncDone) return;
    if (!audioRef.current) return;
    if (isPlayingRef.current) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }, [remoteSyncDone]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  }, []);

  /*
   * `seekingRef` freezes progress updates so a drag isn't fought by incoming
   * `timeupdate` events. The hazard is that it's set by one call site and
   * cleared by another: a caller that begins a seek and never ends it leaves
   * the flag latched, `timeupdate` blocked, and `progress` frozen at the
   * moment of the press — which then reads as playback jumping slightly
   * backwards the next time that stale value is written to `currentTime`.
   *
   * That is exactly what tapping the mini player did: its Scrubber passes
   * `onScrubStart` but no `onScrubEnd`, and a tap that doesn't land on the
   * track element never reaches the handler that would have released it.
   *
   * A watchdog makes the flag self-releasing, so no call site can strand it.
   * The pairing is still the normal path — this only catches the leaks.
   */
  const seekWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSeeking = useCallback(() => {
    if (seekWatchdogRef.current) {
      clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }
    seekingRef.current = false;
    setIsSeeking(false);
  }, []);

  const beginSeek = useCallback(() => {
    seekingRef.current = true;
    setIsSeeking(true);

    if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
    // Comfortably longer than any real drag between pointer samples, short
    // enough that a leaked flag can't survive into the next interaction.
    seekWatchdogRef.current = setTimeout(clearSeeking, 2000);
  }, [clearSeeking]);

  const endSeek = useCallback(
    (time?: number) => {
      if (audioRef.current && time !== undefined) {
        audioRef.current.currentTime = time;
        setProgress(time);
      }
      // A beat for the audio element to process the seek, so the next
      // `timeupdate` reports the new position rather than the old one.
      setTimeout(clearSeeking, 50);
    },
    [clearSeeking]
  );

  // Nothing may outlive the provider.
  useEffect(() => {
    return () => {
      if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
    };
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
      setTimeout(clearSeeking, 50);
    },
    [clearSeeking]
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

  // Both removers compute the new queue *and* the new index up front, then
  // issue plain setState calls. Deriving the index inside a setQueueState
  // updater (as these used to) is unsafe: updaters may run more than once, so
  // the committed queue and the committed index could disagree — the wrong
  // song plays for the details on screen.
  const removeTrack = useCallback((trackId: string) => {
    const prev = queueRef.current;
    const idx = prev.findIndex((t) => t.id === trackId);
    if (idx === -1) return;

    const nextQueue = [...prev];
    nextQueue.splice(idx, 1);
    const ci = currentIndexRef.current;

    setQueueState(nextQueue);

    if (nextQueue.length === 0) {
      setCurrentIndex(0);
      setIsPlaying(false);
      audioRef.current?.pause();
    } else if (idx < ci) {
      setCurrentIndex(Math.max(0, ci - 1));
    } else if (idx === ci) {
      // The playing track was removed — clamp onto whatever now occupies the
      // slot, which is the next track in practice.
      setCurrentIndex(Math.min(ci, nextQueue.length - 1));
    }
  }, []);

  const removeTracks = useCallback((trackIds: string[]) => {
    const idsSet = new Set(trackIds);
    const prev = queueRef.current;
    const playing = prev[currentIndexRef.current];
    const nextQueue = prev.filter((t) => !idsSet.has(t.id));

    setQueueState(nextQueue);

    // Follow the playing track to its new position if it survived — that keeps
    // playback uninterrupted through a bulk removal.
    const survivedIdx = playing ? nextQueue.findIndex((t) => t.id === playing.id) : -1;

    if (survivedIdx >= 0) {
      setCurrentIndex(survivedIdx);
    } else if (nextQueue.length === 0) {
      setCurrentIndex(0);
      setIsPlaying(false);
      audioRef.current?.pause();
    } else {
      setCurrentIndex(Math.min(currentIndexRef.current, nextQueue.length - 1));
    }
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
