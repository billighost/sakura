"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";

interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl: string;
  duration: number;
}

interface PlayerContextType {
  queue: Track[];
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "one" | "all">("off");
  const [liked, setLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const currentTrack = queue[currentIndex] || null;

  // Use refs to avoid stale closures in event handlers
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const goToTrack = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  const next = useCallback(() => {
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
          } else if (ci < q.length - 1) {
            setCurrentIndex(ci + 1);
          } else if (rp === "all") {
            setCurrentIndex(0);
          } else {
            setIsPlaying(false);
          }
        }
      });

      audio.addEventListener("play", () => setIsPlaying(true));
      audio.addEventListener("pause", () => setIsPlaying(false));
    }
  }, []);

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      const wasPlaying = isPlayingRef.current;
      audioRef.current.src = currentTrack.audioUrl;
      audioRef.current.load();
      if (wasPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
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
    setQueueState((prev) => {
      const newQ = [...prev];
      newQ.splice(currentIndexRef.current + 1, 0, track);
      return newQ;
    });
  }, []);

  const addToQueue = useCallback((track: Track) => {
    setQueueState((prev) => [...prev, track]);
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

  const toggleLiked = useCallback(() => setLiked((l) => !l), []);

  // Persist queue to localStorage
  useEffect(() => {
    if (queue.length > 0 && currentTrack) {
      const data = { queue, currentIndex, volume };
      localStorage.setItem("sakura-player", JSON.stringify(data));
    }
  }, [queue, currentIndex, volume]);

  // Restore queue from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sakura-player");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.queue?.length > 0) {
          setQueueState(data.queue);
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
        setVolume,
        next,
        prev,
        toggleShuffle,
        toggleRepeat,
        setQueue,
        removeTrack,
        removeTracks,
        reshuffleQueue,
        isLiked: liked,
        toggleLiked,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
