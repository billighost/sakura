"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TabBar } from "@/components/TabBar";
import { MiniPlayer } from "@/components/MiniPlayer";
import { FullPlayer } from "@/components/FullPlayer";
import { PlayerProvider, usePlayer } from "@/components/PlayerContext";
import { MediaSessionProvider } from "@/components/MediaSessionProvider";
import styles from "./layout.module.css";

function ThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem("sakura-theme");
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, []);
  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const { currentTrack } = usePlayer();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;

      // Allow swipe back if not on main tabs
      const mainTabs = ["/home", "/search", "/library", "/profile"];
      if (mainTabs.includes(pathname)) return;

      if (deltaX > 80 && Math.abs(deltaY) < 40 && touchStartX < 50) {
        router.back();
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pathname, router]);

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
      <ThemeInit />
      <MediaSessionProvider />
      <AppShell>{children}</AppShell>
    </PlayerProvider>
  );
}
