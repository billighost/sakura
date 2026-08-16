import { Metadata } from "next";
import Link from "next/link";
import {
  DownloadedIcon,
  LyricsIcon,
  PetalIcon,
  SearchIcon,
  ShareIcon,
  SparklesIcon,
} from "@/components/Icons";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About — Sakura",
  description: "What Sakura is and how to use it.",
};

/**
 * About.
 *
 * Rewritten for the person the page is actually for. The previous version had
 * three sections titled "Tech Stack", "Roadmap" and "How It Works", the last of
 * which described the *ingestion pipeline* — "Send your music files to our
 * Telegram bot" — which is not something a listener ever does and not how anyone
 * uses the app. Someone arriving cold learnt that it was built with Next.js and
 * nothing about what it would do for them.
 *
 * So: what it is, what it does that other players don't, the three steps you
 * actually take, where the music comes from, and what it costs. The tech stack is
 * gone; it belongs in the README, where it already is.
 */

/** The one thing each of these is for, in the order it matters to a listener. */
const CAPABILITIES = [
  {
    Icon: DownloadedIcon,
    title: "Music that works with no signal",
    body: "Save any song, album or playlist to your phone. It plays on the underground, on a plane, and anywhere the bars run out — and it costs nothing.",
  },
  {
    Icon: SparklesIcon,
    title: "Mixes from what you actually play",
    body: "Sakura watches what you finish and what you skip, and builds mixes from that. When a queue runs out it keeps going with music that fits.",
  },
  {
    Icon: LyricsIcon,
    title: "Lyrics that keep up",
    body: "Words scroll in time with the song. Where a translation or a romanisation exists you can put it underneath, line by line.",
  },
  {
    Icon: ShareIcon,
    title: "Something worth sending",
    body: "Turn a song or a line of a lyric into an image or a short video. The person you send it to gets something they can look at, not a bare link.",
  },
];

/**
 * Three steps, numbered — and numbered because this genuinely is a sequence: you
 * can't save a song you haven't found, and mixes need something to learn from.
 */
const STEPS = [
  {
    Icon: SearchIcon,
    title: "Find something",
    body: "Search a song, an artist or an album. Browse the charts, or pick a genre.",
  },
  {
    Icon: DownloadedIcon,
    title: "Save what you'll want later",
    body: "Tap the save icon on a song, or Save all on an album. Downloads live on your device and work without a connection.",
  },
  {
    Icon: SparklesIcon,
    title: "Let it learn",
    body: "Listen for a few days. Your home screen fills up with mixes built from what you kept playing.",
  },
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.mark} aria-hidden="true">
          <PetalIcon size={30} filled />
        </span>
        <h1 className={styles.title}>Sakura</h1>
        <p className={styles.lede}>
          A music player that keeps your songs on your phone, so they play whether
          or not you have signal.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.heading}>What it does</h2>
        <ul className={styles.capabilities}>
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <li key={title} className={styles.capability}>
              <span className={styles.capabilityIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              <div>
                <h3 className={styles.capabilityTitle}>{title}</h3>
                <p className={styles.capabilityBody}>{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Getting started</h2>
        <ol className={styles.steps}>
          {STEPS.map(({ Icon, title, body }, i) => (
            <li key={title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className={styles.stepTitle}>
                  <span className={styles.stepIcon} aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  {title}
                </h3>
                <p className={styles.stepBody}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Where the music comes from</h2>
        <p className={styles.text}>
          Song and artist details come from Deezer. The recordings themselves are
          found in public Telegram channels — Sakura doesn&apos;t licence them, and
          in most cases the people who made them aren&apos;t paid for these plays.
        </p>
        <p className={styles.text}>
          That&apos;s worth knowing before you decide to use it, so it&apos;s said
          here rather than only in the small print. The{" "}
          <Link href="/terms" className={styles.link}>
            terms
          </Link>{" "}
          go into it properly, including how to get something taken down.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>What it costs</h2>
        <p className={styles.text}>
          Nothing, and there&apos;s nothing to upgrade to. Sakura is a personal
          project run by one person — no ads, no subscription, no company. Which
          also means no support team, and no promise it&apos;ll still be here next
          year, so{" "}
          <Link href="/settings" className={styles.link}>
            export your library
          </Link>{" "}
          now and then.
        </p>
        <p className={styles.text}>
          What it does with your data is set out in{" "}
          <Link href="/privacy" className={styles.link}>
            Privacy
          </Link>
          . The short version: your listening record builds your mixes, and
          nothing else.
        </p>
      </section>
    </div>
  );
}
