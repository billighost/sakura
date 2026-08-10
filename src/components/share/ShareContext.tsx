"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LyricData, LyricLine } from "@/lib/lyrics";

/**
 * The single entry point for sharing.
 *
 * Before this, five call sites each did something different: the mini player's
 * context menu dispatched a `sakura:share` CustomEvent, the full player opened
 * ShareModal directly, the lyrics view called `navigator.share` with the page
 * URL (which told the recipient nothing about what was playing), the track page
 * shared a bare link, and TrackRow did its own thing again. Whatever the
 * studio grows to support, it should be reachable identically from all of them.
 *
 * `openShare(...)` is that path. The CustomEvent is still *listened* for —
 * MiniPlayer's menu is rendered through a portal outside this provider's tree
 * in some layouts, and a decoupled event is genuinely the right tool there —
 * but it is now one door into the same room rather than a parallel
 * implementation.
 */

export interface ShareSubject {
  track: {
    id: string;
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    audioUrl?: string;
    duration?: number;
  };
  /** Lyric lines the user selected, if they shared from the lyrics view. */
  lines?: LyricLine[];
  /** Full lyric data, so the studio can offer synced-lyric video. */
  lyrics?: LyricData | null;
  accentColor?: string | null;
  /** Where playback was, so a video share can default its trim near it. */
  atTime?: number;
}

interface ShareContextValue {
  subject: ShareSubject | null;
  openShare: (subject: ShareSubject) => void;
  closeShare: () => void;
}

const ShareContext = createContext<ShareContextValue | null>(null);

export function useShare(): ShareContextValue {
  const ctx = useContext(ShareContext);
  if (!ctx) throw new Error("useShare must be used within ShareProvider");
  return ctx;
}

/** Payload of the `sakura:share` CustomEvent, kept for decoupled call sites. */
export interface ShareEventDetail {
  track: ShareSubject["track"];
  lines?: LyricLine[];
  lyrics?: LyricData | null;
  accentColor?: string | null;
  atTime?: number;
}

export function ShareProvider({ children }: { children: React.ReactNode }) {
  const [subject, setSubject] = useState<ShareSubject | null>(null);

  const openShare = useCallback((next: ShareSubject) => setSubject(next), []);
  const closeShare = useCallback(() => setSubject(null), []);

  // The decoupled door. Same handler, same state — so a share opened by event
  // and a share opened by hook are indistinguishable downstream.
  useEffect(() => {
    const onShareEvent = (e: Event) => {
      const detail = (e as CustomEvent<ShareEventDetail>).detail;
      if (!detail?.track?.id) return;
      setSubject({
        track: detail.track,
        lines: detail.lines,
        lyrics: detail.lyrics ?? null,
        accentColor: detail.accentColor ?? null,
        atTime: detail.atTime,
      });
    };

    window.addEventListener("sakura:share", onShareEvent);
    return () => window.removeEventListener("sakura:share", onShareEvent);
  }, []);

  const value = useMemo(
    () => ({ subject, openShare, closeShare }),
    [subject, openShare, closeShare]
  );

  return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}
