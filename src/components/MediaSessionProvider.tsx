"use client";
import { useEffect } from "react";
import { usePlayer } from "./PlayerContext";

function getArtworkSizes(url?: string) {
  if (!url) return [];
  // Deezer urls typically look like: .../cover/hash/500x500-000000-80-0-0.jpg
  // Or: .../cover/hash/250x250.jpg, or we can customize sizes using query params if supported,
  // or construct medium/big URLs if we recognize the pattern.
  // Standard Deezer cover URL sizes: 56x56 (small), 250x250 (medium), 500x500 (big), 1000x1000 (huge).
  // Let's offer multiple size declarations. If it's a typical URL containing sizing in it:
  const sizes = ["96x96", "128x128", "192x192", "256x256", "384x384", "512x512"];
  
  // If URL has something like 250x250 or 500x500, we can construct resized URLs
  if (url.includes("deezer.com") || url.includes("dzcdn.net")) {
    return sizes.map((s) => {
      const numericSize = s.split("x")[0];
      // Replace size pattern like /250x250/ or /500x500/ with the target size
      const resizedUrl = url.replace(/\/\d+x\d+(\-\d+)*\//, `/${numericSize}x${numericSize}/`)
                            .replace(/cover\/([^\/]+)\/\d+/, `cover/$1/${numericSize}`);
      return { src: resizedUrl, sizes: s, type: "image/jpeg" };
    });
  }

  // Fallback
  return [
    { src: url, sizes: "96x96", type: "image/png" },
    { src: url, sizes: "128x128", type: "image/png" },
    { src: url, sizes: "192x192", type: "image/png" },
    { src: url, sizes: "256x256", type: "image/png" },
    { src: url, sizes: "384x384", type: "image/png" },
    { src: url, sizes: "512x512", type: "image/png" },
  ];
}

export function MediaSessionProvider() {
  const { currentTrack, isPlaying, isSeeking, progress, duration, togglePlay, next, prev, seekTo } = usePlayer();

  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;

    const artworks = getArtworkSizes(currentTrack.coverUrl);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album || "Sakura",
      artwork: artworks,
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.coverUrl]);

  // Sync playbackState
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Sync position state (guarded by isSeeking)
  useEffect(() => {
    if (!("mediaSession" in navigator) || isSeeking || !currentTrack) return;
    if (typeof navigator.mediaSession.setPositionState === "function") {
      const validDuration = duration && !isNaN(duration) && duration > 0 ? duration : 0;
      const validPosition = progress && !isNaN(progress) && progress >= 0 ? progress : 0;
      
      if (validDuration >= validPosition) {
        try {
          navigator.mediaSession.setPositionState({
            duration: validDuration,
            playbackRate: 1.0,
            position: validPosition,
          });
        } catch (e) {
          console.warn("Failed to set Media Session position state:", e);
        }
      }
    }
  }, [progress, duration, isSeeking, currentTrack]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        seekTo(details.seekTime);
      }
    });

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, [togglePlay, next, prev, seekTo]);

  return null;
}
