"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
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
  const { registerScroller, pushOverlayEntry } = useAppNav();
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

  /*
   * Close the player on Back rather than leaving the page, so the hardware and
   * browser back buttons match the visual stack the user sees.
   *
   * The entry comes from AppNavContext rather than a local `history.pushState`,
   * because owning it here caused two bugs. The provider counted the player's
   * state-only entry as a route push, so `back()` on the page underneath went
   * somewhere else entirely; and the cleanup's bare `history.back()` fired a pop
   * that could land on top of a navigation started in the same moment, which is
   * what a Back tap that appears to do nothing actually is. The provider now
   * knows about overlay entries and serialises the two.
   */
  useEffect(() => {
    if (!fullPlayerOpen) return;
    const retireEntry = pushOverlayEntry();
    const onPop = () => setFullPlayerOpen(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      retireEntry();
    };
  }, [fullPlayerOpen, pushOverlayEntry]);

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

/**
 * Static stand-in for the shell, used only while the URL is unknown.
 *
 * Everything real in this shell hangs off `usePathname()`, which a `[param]`
 * route can't resolve at prerender time. This renders the frame's geometry and
 * nothing else, so the prerendered HTML for those routes still establishes the
 * full-height scroll container and the space the tab bar occupies. Getting the
 * geometry right is the whole job: if the fallback and the real shell disagreed
 * on height, every param route would visibly reflow the instant it hydrated.
 */
function ShellFrame() {
  return (
    <div className={styles.root}>
      <div className={styles.content} data-app-scroll />
      <div className={styles.bottom} />
    </div>
  );
}

export default function AppShellRoot({ children }: { children: React.ReactNode }) {
  /*
   * The boundary exists for prerendering, not for runtime.
   *
   * `AppNavProvider` and `PlayerContext` both read `usePathname()`, and they sit
   * above every page here. On a static route the path is known at build time and
   * renders straight through this boundary. On a `[param]` route it's runtime
   * data, so without a boundary the prerender fails outright
   * (`CLIENT_HOOK_DYNAMIC`) and the build stops — `instant = false` does not
   * clear it, because this is a real inability to prerender rather than a
   * validation preference.
   *
   * With the boundary, those routes prerender `<ShellFrame />` as their static
   * shell and stream the real one. In the browser `usePathname()` returns
   * synchronously, so nothing ever suspends here on a live navigation and the
   * shell mounts exactly as it did before.
   */
  return (
    <Suspense fallback={<ShellFrame />}>
      <PlayerProvider>
        <MediaSessionProvider />
        <AppNavProvider>
          <ShareProvider>
            <AppShell>{children}</AppShell>
          </ShareProvider>
        </AppNavProvider>
      </PlayerProvider>
    </Suspense>
  );
}
