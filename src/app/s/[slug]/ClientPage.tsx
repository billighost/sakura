"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { renderShareCard, canvasToBlob, type CardTrack } from "@/lib/shareCard";
import { deliverShare, shareFilename } from "@/lib/shareDelivery";
import styles from "./page.module.css";

interface Props {
  kind: string;
  track: CardTrack;
  lines: string[];
  lyricTime?: number;
  theme: string;
  sharedBy: string;
  /**
   * Whether the viewer has an account and is signed in.
   *
   * A share link is the one page in the app built to be opened by someone who
   * isn't a user yet, so it has to tell them the truth about what the button
   * does — see the CTA below.
   */
  isSignedIn: boolean;
}

export function ShareClientPage({ kind, track, lines, lyricTime, theme, sharedBy, isSignedIn }: Props) {
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
        if (!cancelled) setError("Couldn't render the card.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [track.id, kind, theme, lines]);

  /**
   * Where the primary button goes, and what it admits to.
   *
   * This used to be an unconditional "Open Sakura" that pushed `/home`. For a
   * signed-in viewer that's right, but a share link is deliberately public — the
   * whole point is that it's sent to someone else — so the typical visitor here
   * is *not* signed in, and for them the proxy turned that tap into a silent
   * bounce to a login screen they hadn't asked for and weren't told about.
   *
   * Signed out, the button now says so and carries `next`, so signing in lands
   * them on the track that was shared with them rather than a generic home feed.
   * That's the difference between a share link that recruits someone and one
   * that loses them at an unexplained login wall.
   */
  const destination = track.id ? `/track/${track.id}` : "/home";

  const handleGoToApp = () => {
    router.push(
      isSignedIn ? destination : `/login?next=${encodeURIComponent(destination)}`
    );
  };

  const handleShare = async () => {
    if (!imageBlob) return;
    // Through the shared delivery layer so this page gets the same
    // cancelled-is-not-an-error handling and download fallback as the studio.
    // Previously an unsupported target silently did nothing at all.
    const outcome = await deliverShare({
      blob: imageBlob,
      filename: shareFilename(track, "png"),
      text: `${track.title} — ${track.artist}`,
      title: track.title,
    });
    if (outcome.kind === "failed") setError(outcome.message);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.art}>
          {error ? (
            <div className={styles.error}>{error}</div>
          ) : (
            <canvas
              ref={canvasRef}
              width={1080}
              height={1080}
              style={{
                width: "100%",
                maxWidth: "20rem",
                aspectRatio: "1",
                borderRadius: "16px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              }}
            />
          )}
        </div>

        <div className={styles.info}>
          {kind === "lyric" && lines.length > 0 && (
            <p className={styles.lyric}>"{lines[0]}"</p>
          )}
          <h1 className={styles.title}>{track.title}</h1>
          <p className={styles.artist}>{track.artist}</p>
          <p className={styles.sharedBy}>Shared by {sharedBy} · Sakura</p>
        </div>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={handleGoToApp}>
            {isSignedIn ? "Open Sakura" : "Log in to listen"}
          </button>
          {imageBlob && (
            <button className={styles.secondary} onClick={handleShare}>
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
