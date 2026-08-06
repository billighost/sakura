"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getAudioBlob, getCachedUserId, getDeviceId } from "@/lib/offline-db";
import { extractDominantColor } from "@/lib/color";
import { getLyrics, LyricData } from "@/lib/lyrics";

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
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekingRef = useRef(false);
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
  const [isSeeking, setIsSeeking] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [miniArtRect, setMiniArtRect] = useState<DOMRect | null>(null);
  const [lyrics, setLyrics] = useState<LyricData | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState(false);

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

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { upNextRef.current = upNextQueue; }, [upNextQueue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const goToTrack = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const next = useCallback(() => {
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
      goToTrack(nextIdx);
    } else if (ci < q.length - 1) {
      goToTrack(ci + 1);
    } else if (rp === "all") {
      goToTrack(0);
    } else {
      setIsPlaying(false);
    }
  }, [goToTrack]);

  const prev = useCallback(() => {
    const ci = currentIndexRef.current;
    if (progress > 3) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      setProgress(0);
    } else if (ci > 0) {
      goToTrack(ci - 1);
    } else {
      goToTrack(queueRef.current.length - 1);
    }
  }, [progress, goToTrack]);

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

      audio.addEventListener("ended", () => {
        if (repeatRef.current === "one") {
          audioRef.current?.play().catch(() => {});
        } else {
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
            // Autoplay next item after state update settles
            setTimeout(() => {
              audioRef.current?.play().catch(() => {});
            }, 50);
            return;
          }

          // Use refs to avoid stale closure
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
            setTimeout(() => {
              audioRef.current?.play().catch(() => {});
            }, 50);
          } else if (ci < q.length - 1) {
            setCurrentIndex(ci + 1);
            setTimeout(() => {
              audioRef.current?.play().catch(() => {});
            }, 50);
          } else if (rp === "all") {
            setCurrentIndex(0);
            setTimeout(() => {
              audioRef.current?.play().catch(() => {});
            }, 50);
          } else {
            setIsPlaying(false);
          }
        }
      });

      audio.addEventListener("play", () => setIsPlaying(true));
      audio.addEventListener("pause", () => setIsPlaying(false));
    }
  }, []);

  // Hydrate player settings and queue from localStorage on mount
  useEffect(() => {
    try {
      const savedQueue = localStorage.getItem("sakura-player-queue");
      const savedIndex = localStorage.getItem("sakura-player-index");
      const savedProgress = localStorage.getItem("sakura-player-progress");
      const savedVolume = localStorage.getItem("sakura-player-volume");
      const savedShuffle = localStorage.getItem("sakura-player-shuffle");
      const savedRepeat = localStorage.getItem("sakura-player-repeat");

      if (savedQueue) setQueueState(JSON.parse(savedQueue));
      if (savedIndex) setCurrentIndex(Number(savedIndex));
      if (savedProgress) setProgress(Number(savedProgress));
      if (savedVolume) {
        const vol = Number(savedVolume);
        setVolumeState(vol);
        if (audioRef.current) audioRef.current.volume = vol;
      }
      if (savedShuffle) setShuffle(savedShuffle === "true");
      if (savedRepeat) setRepeat(savedRepeat as any);
    } catch (e) {
      console.error("Failed to restore player state:", e);
    }
  }, []);

  // Persist state updates to localStorage
  useEffect(() => {
    localStorage.setItem("sakura-player-queue", JSON.stringify(queue));
  }, [queue]);

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

  // Periodic progress saving (e.g., every 3s to minimize disk writes, plus updates on unload)
  useEffect(() => {
    if (seekingRef.current) return;
    localStorage.setItem("sakura-player-progress", String(progress));
  }, [progress]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let isInitialLoad = true;

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

      if (!active) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }

      // Guard: if this exact source is already loaded (e.g. an effect re-run that
      // didn't actually change tracks), skip the reload entirely — calling
      // `.load()` on an already-current src is what snaps playback back to 0.
      const resolvedSrc = new URL(src, window.location.href).href;
      if (audioRef.current.src === resolvedSrc) {
        return;
      }

      audioRef.current.src = src;
      audioRef.current.load();

      // If initial load of the session, restore the saved timestamp progress
      if (isInitialLoad) {
        isInitialLoad = false;
        const savedProgress = localStorage.getItem("sakura-player-progress");
        if (savedProgress) {
          const time = Number(savedProgress);
          audioRef.current.currentTime = time;
          setProgress(time);
        }
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
    setTimeout(() => {
      audioRef.current?.play().catch(() => {});
    }, 50);
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



  // Persist queue to localStorage
  useEffect(() => {
    if (queue.length > 0 && currentTrack) {
      const data = { queue, upNextQueue, currentIndex, volume };
      localStorage.setItem("sakura-player", JSON.stringify(data));
    }
  }, [queue, upNextQueue, currentIndex, volume]);

  // Restore queue from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sakura-player");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.queue?.length > 0) {
          setQueueState(data.queue);
          if (data.upNextQueue) setUpNextQueue(data.upNextQueue);
          setCurrentIndex(data.currentIndex || 0);
          setVolumeState(data.volume || 1);
        }
      } catch {}
    }
  }, []);

  return (
    <PlayerContext.Provider
      value={{
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
      }}
    >
      {children}
      <div aria-live="polite" aria-atomic="true" className="srOnly">
        {announcement}
      </div>
    </PlayerContext.Provider>
  );
}
