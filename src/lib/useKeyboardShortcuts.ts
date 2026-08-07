"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/PlayerContext";

interface Options {
  onToggleFullPlayer: () => void;
  fullPlayerOpen: boolean;
}

/** True when the key event came from somewhere typing is expected. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Desktop keyboard control.
 *
 * Deliberately mirrors the shortcuts people already know from Spotify and
 * YouTube, so there's nothing to learn. Everything is suppressed while focus is
 * in a text field — otherwise typing "s" into search would toggle shuffle.
 */
export function useKeyboardShortcuts({ onToggleFullPlayer, fullPlayerOpen }: Options) {
  const router = useRouter();
  const {
    togglePlay,
    next,
    prev,
    seek,
    progress,
    duration,
    volume,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    toggleLiked,
    currentTrack,
  } = usePlayer();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Leave browser and OS chords alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      // "/" focuses search from anywhere — the one shortcut that navigates.
      if (key === "/") {
        e.preventDefault();
        const existing = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[data-search-input]'
        );
        if (existing) existing.focus();
        else router.push("/search");
        return;
      }

      if (key === "Escape" && fullPlayerOpen) {
        e.preventDefault();
        onToggleFullPlayer();
        return;
      }

      // Everything below acts on playback and is meaningless with no track.
      if (!currentTrack) return;

      switch (key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          togglePlay();
          break;

        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(duration, progress + (e.shiftKey ? 30 : 5)));
          break;

        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, progress - (e.shiftKey ? 30 : 5)));
          break;

        case "l":
        case "L":
          e.preventDefault();
          seek(Math.min(duration, progress + 10));
          break;

        case "j":
        case "J":
          e.preventDefault();
          seek(Math.max(0, progress - 10));
          break;

        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, Math.round((volume + 0.05) * 100) / 100));
          break;

        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, Math.round((volume - 0.05) * 100) / 100));
          break;

        case "n":
        case "N":
          e.preventDefault();
          next();
          break;

        case "p":
        case "P":
          e.preventDefault();
          prev();
          break;

        case "s":
        case "S":
          e.preventDefault();
          toggleShuffle();
          break;

        case "r":
        case "R":
          e.preventDefault();
          toggleRepeat();
          break;

        case "f":
        case "F":
          e.preventDefault();
          toggleLiked();
          break;

        case "Enter":
          e.preventDefault();
          onToggleFullPlayer();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    togglePlay,
    next,
    prev,
    seek,
    progress,
    duration,
    volume,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    toggleLiked,
    currentTrack,
    router,
    onToggleFullPlayer,
    fullPlayerOpen,
  ]);
}
