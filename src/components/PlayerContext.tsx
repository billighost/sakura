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
  setVolume: (vol: number) => void;
  next: () => void;
  prev: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueueState] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "one" | "all">("off");

  const currentTrack = queue[currentIndex] || null;

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;

      audioRef.current.addEventListener("timeupdate", () => {
        if (audioRef.current) {
          setProgress(audioRef.current.currentTime);
          setDuration(audioRef.current.duration || 0);
        }
      });

      audioRef.current.addEventListener("ended", () => {
        if (repeat === "one") {
          audioRef.current?.play();
        } else {
          next();
        }
      });

      audioRef.current.addEventListener("play", () => setIsPlaying(true));
      audioRef.current.addEventListener("pause", () => setIsPlaying(false));
    }
  }, []);

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      audioRef.current.src = currentTrack.audioUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [currentTrack?.id]);

  const play = useCallback((track: Track, newQueue?: Track[]) => {
    if (newQueue) {
      setQueueState(newQueue);
      const idx = newQueue.findIndex((t) => t.id === track.id);
      setCurrentIndex(idx >= 0 ? idx : 0);
    } else {
      setQueueState((prev) => {
        const idx = prev.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          setCurrentIndex(idx);
          return prev;
        }
        const newQ = [...prev];
        newQ.splice(currentIndex + 1, 0, track);
        setQueueState(newQ);
        setCurrentIndex(currentIndex + 1);
        return newQ;
      });
    }
    audioRef.current?.play().catch(() => {});
  }, [currentIndex]);

  const playNext = useCallback((track: Track) => {
    setQueueState((prev) => {
      const newQ = [...prev];
      newQ.splice(currentIndex + 1, 0, track);
      return newQ;
    });
  }, [currentIndex]);

  const addToQueue = useCallback((track: Track) => {
    setQueueState((prev) => [...prev, track]);
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  }, []);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    if (shuffle) {
      setCurrentIndex(Math.floor(Math.random() * queue.length));
    } else if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else if (repeat === "all") {
      setCurrentIndex(0);
    } else {
      setIsPlaying(false);
    }
  }, [queue.length, currentIndex, shuffle, repeat]);

  const prev = useCallback(() => {
    if (progress > 3) {
      seek(0);
    } else if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [progress, currentIndex, seek]);

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

  // Persist queue to localStorage
  useEffect(() => {
    if (queue.length > 0 && currentTrack) {
      const data = { queue, currentIndex, progress, volume };
      localStorage.setItem("sakura-player", JSON.stringify(data));
    }
  }, [queue, currentIndex, progress, volume]);

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
        setVolume,
        next,
        prev,
        toggleShuffle,
        toggleRepeat,
        setQueue,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
