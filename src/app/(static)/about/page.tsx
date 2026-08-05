import { Metadata } from "next";
import Image from "next/image";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — Sakura",
  description: "About Sakura, your personal music library app.",
};

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    title: "Stream Anywhere",
    description: "Access your personal music library from any browser on desktop or mobile.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
    title: "Telegram Import",
    description: "Send music files directly through our Telegram bot for instant library updates.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: "Smart Search",
    description: "Full-text search across your entire library to find any track instantly.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
    title: "Playlist Management",
    description: "Create, edit, and organize custom playlists to match your mood.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 18v-6a9 9 0 0118 0v6" />
        <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
      </svg>
    ),
    title: "Audio Visualizer",
    description: "Beautiful audio visualizations that react to your music during playback.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
    title: "Offline Support",
    description: "Cache your music for listening without an internet connection.",
  },
];

const techStack = [
  { name: "Next.js", icon: "N" },
  { name: "React", icon: "R" },
  { name: "TypeScript", icon: "TS" },
  { name: "PostgreSQL", icon: "PG" },
  { name: "Prisma", icon: "◆" },
  { name: "Redis", icon: "R" },
  { name: "Cloudinary", icon: "C" },
  { name: "Telegram", icon: "T" },
];

const roadmap = [
  { text: "Multi-user support", done: false },
  { text: "Collaborative playlists", done: false },
  { text: "Last.fm scrobbling", done: false },
  { text: "Lyrics display", done: false },
  { text: "Gapless playback", done: false },
  { text: "Smart playlists", done: false },
  { text: "Dark & light themes", done: true },
  { text: "Keyboard shortcuts", done: true },
  { text: "Offline caching", done: true },
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.iconWrapper}>
          <Image
            src="/icons/icon-transparent-192.png"
            alt="Sakura icon"
            width={80}
            height={80}
            className={styles.icon}
            priority
          />
          <div className={styles.iconPulse} />
        </div>
        <h1 className={styles.title}>Sakura</h1>
        <div className={styles.badge}>v0.1.0</div>
        <p className={styles.subtitle}>
          Your personal music library. Stream, organize, and enjoy your legally-owned music collection without ads, algorithms, or data harvesting.
        </p>
      </div>

      <section className={styles.section}>
        <h2 className={styles.heading}>Features</h2>
        <div className={styles.featuresGrid}>
          {features.map((feature, i) => (
            <div key={i} className={styles.featureCard}>
              <div className={styles.featureIcon}>{feature.icon}</div>
              <div className={styles.featureContent}>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureDesc}>{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Tech Stack</h2>
        <div className={styles.techGrid}>
          {techStack.map((tech, i) => (
            <div key={i} className={styles.techItem}>
              <span className={styles.techIcon}>{tech.icon}</span>
              <span className={styles.techName}>{tech.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Roadmap</h2>
        <div className={styles.roadmapList}>
          {roadmap.map((item, i) => (
            <div key={i} className={`${styles.roadmapItem} ${item.done ? styles.roadmapDone : ""}`}>
              <div className={styles.roadmapCheck}>
                {item.done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <div className={styles.roadmapEmpty} />
                )}
              </div>
              <span className={styles.roadmapText}>{item.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>How It Works</h2>
        <div className={styles.howItWorks}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>Send Music</h3>
              <p className={styles.stepDesc}>Send your music files to our Telegram bot</p>
            </div>
          </div>
          <div className={styles.stepConnector} />
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>Auto-Process</h3>
              <p className={styles.stepDesc}>Metadata extracted, album art retrieved automatically</p>
            </div>
          </div>
          <div className={styles.stepConnector} />
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepContent}>
              <h3 className={styles.stepTitle}>Listen</h3>
              <p className={styles.stepDesc}>Stream from any device with a browser</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Acknowledgments</h2>
        <p className={styles.text}>
          Sakura is built with Next.js, Prisma, PostgreSQL, and the Telegram Bot API.
          Audio processing relies on browser-native Web Audio API capabilities. Album art
          is sourced from public metadata providers.
        </p>
        <p className={styles.text}>
          The name &quot;Sakura&quot; is inspired by the Japanese cherry blossom, symbolizing the
          beauty of simplicity.
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
