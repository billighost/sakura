"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { renderShareCard, canvasToBlob, type CardTrack } from "@/lib/shareCard";
import styles from "./page.module.css";

interface Props {
  kind: string;
  track: CardTrack;
  lines: string[];
  lyricTime?: number;
  theme: string;
  sharedBy: string;
}

export function ShareClientPage({ kind, track, lines, lyricTime, theme, sharedBy }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        await renderShareCard(canvasRef.current!, {
          track,
          lines,
          accentColor: null,
          format: "square",
          seed: track.id,
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
  }, [track.id]);

  const handleGoToApp = () => {
    router.push("/home");
  };

  const handleShare = async () => {
    if (!imageBlob) return;
    const file = new File([imageBlob], `${track.artist}-${track.title}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    }
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
            Open Sakura
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
