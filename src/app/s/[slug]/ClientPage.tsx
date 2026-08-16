"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { renderShareCard, canvasToBlob, type CardTrack } from "@/lib/shareCard";
import { deliverShare, shareFilename } from "@/lib/shareDelivery";
import { DownloadedIcon, LyricsIcon, PetalIcon, ShareIcon, SparklesIcon } from "@/components/Icons";
import styles from "./page.module.css";

/**
 * The public share landing page.
 *
 * This is the only screen in the app most of its visitors will ever see: a share
 * link is sent to someone else by definition, so the typical arrival here has no
 * account and no idea what Sakura is.
 *
 * It used to treat them as a lapsed user — a card, a title, and one button
 * reading "Log in to listen". Two problems with that. Someone with no account
 * can't log in, so the primary action was the wrong one; and nothing on the page
 * said what they'd be logging into, so there was no reason to.
 *
 * Now it answers both: the shared thing is still the hero, and under it a
 * signed-out visitor gets a one-line statement of what the app is, three things
 * it does, and an invitation to sign up — with signing in kept as the quieter
 * option for the minority who already have an account. The card can still be
 * saved and passed on without signing up at all, which is the honest way to be
 * useful to someone who's never going to.
 */

interface Props {
  kind: string;
  track: CardTrack;
  lines: string[];
  lyricTime?: number;
  theme: string;
  sharedBy: string;
  /** Whether the viewer has an account and is signed in. */
  isSignedIn: boolean;
}

export function ShareClientPage({ kind, track, lines, theme, sharedBy, isSignedIn }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        /*
         * A lyric share gets the quote variant so the recipient lands on the
         * words that were actually sent; a track share gets the sleeve, where
         * the artwork carries it. Rendering both as "sleeve" lost the point of
         * a lyric link.
         */
        await renderShareCard(canvasRef.current!, {
          track,
          lines,
          variant: kind === "lyric" && lines.length > 0 ? "quote" : "sleeve",
          accentColor: null,
          format: "square",
          theme: theme === "light" ? "light" : "dark",
        });
        const blob = await canvasToBlob(canvasRef.current!);
        if (blob && !cancelled) setImageBlob(blob);
      } catch {
        if (!cancelled) setError("We couldn't draw the card, but the song details are below.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the track's identity, not the object's: `track` is rebuilt by the
    // server component on every render, so depending on it would redraw a
    // 1080×1080 canvas continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, kind, theme, lines]);

  /*
   * Where the buttons go. `next` carries the shared track through sign-up and
   * sign-in, so whichever door they come through they land on the thing that was
   * shared with them rather than a generic home feed.
   */
  const destination = track.id ? `/track/${track.id}` : "/home";
  const withNext = (path: string) => `${path}?next=${encodeURIComponent(destination)}`;

  const handleSaveCard = async () => {
    if (!imageBlob) return;
    // Through the shared delivery layer so this page gets the same
    // cancelled-is-not-an-error handling and download fallback as the studio.
    const outcome = await deliverShare({
      blob: imageBlob,
      filename: shareFilename(track, "png"),
      text: `${track.title} — ${track.artist}`,
      title: track.title,
    });
    if (outcome.kind === "failed") setError(outcome.message);
  };

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <PetalIcon size={18} filled />
          </span>
          Sakura
        </header>

        <section className={styles.shared}>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : (
            <canvas ref={canvasRef} width={1080} height={1080} className={styles.canvas} />
          )}

          <div className={styles.info}>
            {kind === "lyric" && lines.length > 0 && (
              <p className={styles.lyric}>&ldquo;{lines[0]}&rdquo;</p>
            )}
            <h1 className={styles.title}>{track.title}</h1>
            <p className={styles.artist}>{track.artist}</p>
            <p className={styles.sharedBy}>Shared by {sharedBy}</p>
          </div>
        </section>

        {isSignedIn ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.primary} pressable`}
              onClick={() => router.push(destination)}
            >
              Play it
            </button>
            {imageBlob && (
              <button
                type="button"
                className={`${styles.secondary} pressable`}
                onClick={handleSaveCard}
              >
                <ShareIcon size={16} />
                Pass it on
              </button>
            )}
          </div>
        ) : (
          <>
            {/*
              The pitch. Three things, each one a real capability rather than a
              slogan — and the offline one first, because it's the one thing here
              that the big streaming apps make you pay for.
            */}
            <section className={styles.pitch}>
              <h2 className={styles.pitchTitle}>What Sakura is</h2>
              <p className={styles.pitchLede}>
                A music player that keeps your songs on your phone, so they play
                whether or not you have signal.
              </p>
              <ul className={styles.features}>
                <li>
                  <DownloadedIcon size={16} />
                  Save anything for offline — free
                </li>
                <li>
                  <LyricsIcon size={16} />
                  Lyrics that follow along, line by line
                </li>
                <li>
                  <SparklesIcon size={16} />
                  Mixes built from what you actually play
                </li>
              </ul>
            </section>

            <div className={styles.actions}>
              <a href={withNext("/register")} className={`${styles.primary} pressable`}>
                Create a free account
              </a>
              <a href={withNext("/login")} className={`${styles.quiet} pressable`}>
                I already have one
              </a>
            </div>

            {/* Useful without an account. Saving the card needs no sign-up, and
                offering it makes the page worth opening either way. */}
            {imageBlob && (
              <button
                type="button"
                className={`${styles.cardAction} pressable`}
                onClick={handleSaveCard}
              >
                <ShareIcon size={15} />
                Save or pass on this card
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
