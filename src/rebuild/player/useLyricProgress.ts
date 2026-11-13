"use client";
import { useMemo, useSyncExternalStore } from "react";
import { usePlaybackProgressStore } from "../app/MusicContext";
import { lyricMoment } from "./lyricFollow";
import { miniLyricCue } from "./miniLyric";
import type { PlayerLyricLine } from "./useLyrics";
import { createPlaybackSelection } from "./playbackSelection";

export function useLyricMoment(lines: readonly PlayerLyricLine[] | undefined, enabled = true) {
  const store = usePlaybackProgressStore();
  const selector = useMemo(() => createPlaybackSelection(store,
    progress => enabled && lines ? lyricMoment(lines, progress.positionMs / 1000) : { index: -1, kind: "empty" as const },
    (left, right) => left.index === right.index && left.kind === right.kind), [store, lines, enabled]);
  return useSyncExternalStore(selector.subscribe, selector.getSnapshot, selector.getServerSnapshot);
}

export function useMiniLyricCue(lines: readonly PlayerLyricLine[] | undefined, enabled = true) {
  const store = usePlaybackProgressStore();
  const selector = useMemo(() => createPlaybackSelection(store,
    progress => enabled && lines ? miniLyricCue(lines, progress.positionMs) : null,
    (left, right) => left === right || Boolean(left && right && left.index === right.index && left.start === right.start && left.text === right.text && left.romanized === right.romanized)), [store, lines, enabled]);
  return useSyncExternalStore(selector.subscribe, selector.getSnapshot, selector.getServerSnapshot);
}

export function usePlaybackDuration(enabled = true) {
  const store = usePlaybackProgressStore();
  const selector = useMemo(() => createPlaybackSelection(store,
    progress => enabled ? progress.durationMs : 0, Object.is), [store, enabled]);
  return useSyncExternalStore(selector.subscribe, selector.getSnapshot, selector.getServerSnapshot);
}
