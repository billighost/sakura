"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { TabBar } from "@/components/TabBar";
import { MiniPlayer } from "@/components/MiniPlayer";
import { FullPlayer } from "@/components/FullPlayer";
import { PlayerProvider, usePlayer } from "@/components/PlayerContext";
import { MediaSessionProvider } from "@/components/MediaSessionProvider";
import { AppNavProvider, useAppNav } from "@/components/AppNavContext";
import { ShareProvider } from "@/components/share/ShareContext";
import { ShareStudio } from "@/components/share/ShareStudio";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SmoothScroll } from "@/components/SmoothScroll";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import styles from "./layout.module.css";

function AppShell({ children }: { children: React.ReactNode }) {
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const { currentTrack } = usePlayer();
  const { registerScroller } = useAppNav();
  const pathname = usePathname();

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
      {/*
        The app's one scroll container. Everything that needs to read or drive
        page scroll — scroll restoration, the collapsing header, tap-active-tab
        -to-top, the scroll lock behind a sheet — finds it by this ref or the
        `data-app-scroll` attribute, rather than each guessing at `window`.
      */}
      <div ref={registerScroller} className={styles.content} data-app-scroll>
        {children}
      </div>

      {/* Smooth wheel scrolling for the resolved page scroller. Touch stays
          native — see the note in SmoothScroll.tsx. */}
      <SmoothScroll routeKey={pathname} />

      <div className={styles.bottom}>
        {currentTrack && <MiniPlayer onExpand={() => setFullPlayerOpen(true)} />}
        <TabBar />
      </div>

      <FullPlayer open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} />

      {/* Mounted once, at the root: every share site in the app drives this one
          sheet through ShareContext rather than each rolling its own. */}
      <ShareStudio />

      {/* Decides for itself whether this is a moment worth asking at — see
          lib/installPrompt.ts. Renders nothing the overwhelming majority of
          the time. Kept inside the app group so it can never appear over the
          auth screens, where the app hasn't earned the ask yet. */}
      <InstallPrompt />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerProvider>
      <MediaSessionProvider />
      <AppNavProvider>
        <ShareProvider>
          <AppShell>{children}</AppShell>
        </ShareProvider>
      </AppNavProvider>
    </PlayerProvider>
  );
}
