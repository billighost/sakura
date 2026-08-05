"use client";
import { useEffect } from "react";
import { usePlayer } from "./PlayerContext";

export function MediaSessionProvider() {
  const { currentTrack, isPlaying, togglePlay, next, prev, seek } = usePlayer();

  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album || "Sakura",
      artwork: currentTrack.coverUrl
        ? [{ src: currentTrack.coverUrl, sizes: "512x512", type: "image/png" }]
        : [],
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.coverUrl]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("nexttrack", () => next());
    navigator.mediaSession.setActionHandler("previoustrack", () => prev());
    navigator.mediaSession.setActionHandler("seekto", (e) => {
      if (e.seekTime != null) seek(e.seekTime);
    });
    navigator.mediaSession.setActionHandler("seekbackward", (e) => {
      const state = (navigator.mediaSession as any).positionState;
      const curr = state?.currentTime || 0;
      seek(curr - (e.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler("seekforward", (e) => {
      const state = (navigator.mediaSession as any).positionState;
      const curr = state?.currentTime || 0;
      seek(curr + (e.seekOffset || 10));
    });

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    };
  }, [togglePlay, next, prev, seek]);

  return null;
}
