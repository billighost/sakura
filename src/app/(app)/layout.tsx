"use client";

import { useState, useEffect, useCallback } from "react";
import { TabBar } from "@/components/TabBar";
import { MiniPlayer } from "@/components/MiniPlayer";
import { FullPlayer } from "@/components/FullPlayer";
import { PlayerProvider, usePlayer } from "@/components/PlayerContext";
import { MediaSessionProvider } from "@/components/MediaSessionProvider";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import styles from "./layout.module.css";

function AppShell({ children }: { children: React.ReactNode }) {
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const { currentTrack } = usePlayer();

  // Single registration. This used to be an inline copy of the same listener
  // that `useSwipeBack` installs, so on pages calling the hook a swipe fired
  // router.back() twice.
  useSwipeBack();

  useKeyboardShortcuts({
    onToggleFullPlayer: useCallback(() => {
      setFullPlayerOpen((open) => !open);
    }, []),
    fullPlayerOpen,
  });

  // Close the player on Back rather than leaving the page, so the hardware/
  // browser back button matches the visual stack the user sees.
  useEffect(() => {
    if (!fullPlayerOpen) return;
    window.history.pushState({ sakuraPlayer: true }, "");
    const onPop = () => setFullPlayerOpen(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // If the player was closed by any other means, retire the history entry
      // we pushed so Back doesn't need pressing twice.
      if (window.history.state?.sakuraPlayer) window.history.back();
    };
  }, [fullPlayerOpen]);

  return (
    <div className={styles.root}>
      <div className={styles.content}>{children}</div>
      <div className={styles.bottom}>
        {currentTrack && <MiniPlayer onExpand={() => setFullPlayerOpen(true)} />}
        <TabBar />
      </div>
      <FullPlayer open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerProvider>
      <MediaSessionProvider />
      <AppShell>{children}</AppShell>
    </PlayerProvider>
  );
}
