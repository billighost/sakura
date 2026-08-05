"use client";

import { useState, useEffect } from "react";
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
