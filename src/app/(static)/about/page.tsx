import { Metadata } from "next";
import Image from "next/image";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — Sakura",
  description: "About Sakura, your personal music library app.",
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Image
          src="/icons/icon-transparent-192.png"
          alt="Sakura icon"
          width={96}
          height={96}
          className={styles.icon}
          priority
        />
        <h1 className={styles.title}>About Sakura</h1>
        <p className={styles.version}>Version 0.1.0</p>
      </div>

      <section className={styles.section}>
        <p className={styles.text}>
          <strong>Sakura</strong> is a personal music library application designed for managing
          your own legally-owned music collection. Built as a passion project, it provides a
          clean, fast, and private way to organize and stream your music without ads,
          algorithms, or data harvesting.
        </p>
        <p className={styles.text}>
          Your music is sourced from your own collection via Telegram integration, stored
          securely in the cloud, and accessible from any device with a browser. Sakura is a
          single-user application — your library, your data, your music.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Features</h2>
        <ul className={styles.list}>
          <li>Stream your personal music library from any browser</li>
          <li>Import music files directly via Telegram bot integration</li>
          <li>Automatic metadata extraction and album art retrieval</li>
          <li>Create, edit, and organize custom playlists</li>
          <li>Full-text search across your entire library</li>
          <li>Offline caching for listening without an internet connection</li>
          <li>Responsive design that works on desktop and mobile</li>
          <li>Keyboard shortcuts for quick navigation and playback control</li>
          <li>Dark and light theme support</li>
          <li>Audio visualizations during playback</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Tech Stack</h2>
        <ul className={styles.list}>
          <li><strong>Framework:</strong> Next.js 16 (App Router, React 19)</li>
          <li><strong>Database:</strong> PostgreSQL via Prisma ORM</li>
          <li><strong>Authentication:</strong> NextAuth.js v5</li>
          <li><strong>File Storage:</strong> Cloudinary</li>
          <li><strong>Caching:</strong> Upstash Redis</li>
          <li><strong>Music Import:</strong> Telegram Bot API</li>
          <li><strong>Offline Support:</strong> Service Worker + IndexedDB</li>
          <li><strong>Language:</strong> TypeScript</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Roadmap</h2>
        <ul className={styles.list}>
          <li>Multi-user support with separate libraries</li>
          <li>Collaborative playlist editing</li>
          <li>Last.fm scrobbling integration</li>
          <li>Lyrics display and sync</li>
          <li>Gapless playback and crossfade</li>
          <li>Smart playlists based on listening history</li>
          <li>Podcast support</li>
          <li>Native mobile apps (iOS and Android)</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Acknowledgments</h2>
        <p className={styles.text}>
          Sakura is built with Next.js, Prisma, PostgreSQL, and the Telegram Bot API.
          Audio processing relies on browser-native Web Audio API capabilities. Album art
          is sourced from public metadata providers. The name &quot;Sakura&quot; is inspired by the
          Japanese cherry blossom, symbolizing the beauty of simplicity.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Disclaimer</h2>
        <p className={styles.text}>
          <strong>This is a personal project</strong> and is not affiliated with any commercial
          music streaming service. All audio files processed through Sakura are owned by the
          user. The developer assumes no responsibility for misuse of this application.
        </p>
      </section>
    </div>
  );
}
