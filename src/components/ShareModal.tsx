"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { renderShareCard, canvasToBlob, type CardTrack, DIMENSIONS } from "@/lib/shareCard";
import styles from "./ShareModal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  track: CardTrack;
  /** Selected lyric lines, joined or array. */
  lyricText?: string;
  /** Line timestamps, for the "jump to this moment" link. */
  lyricTime?: number;
  accentColor: string | null;
}

type Format = "story" | "square" | "landscape";

const FORMATS: { key: Format; label: string; dims: { w: number; h: number } }[] = [
  { key: "story", label: "Story", dims: DIMENSIONS.story },
  { key: "square", label: "Post", dims: DIMENSIONS.square },
  { key: "landscape", label: "OG", dims: DIMENSIONS.landscape },
];

export function ShareModal({ open, onClose, track, lyricText, lyricTime, accentColor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Format>("story");
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () => (lyricText ? lyricText.split("\n").filter(Boolean) : []),
    [lyricText],
  );

  // The render only reads these fields, so depending on the primitives keeps a
  // parent that rebuilds its `track` object each render from re-triggering an
  // expensive canvas draw on every commit.
  const { id: trackId, title, artist, coverUrl } = track;
  const card = useMemo(
    () => ({ id: trackId, title, artist, coverUrl }),
    [trackId, title, artist, coverUrl],
  );

  // Re-render the preview when the format or track changes.
  useEffect(() => {
    if (!open || !canvasRef.current) return;

    let cancelled = false;
    const canvas = canvasRef.current;

    setRendering(true);
    setError(null);

    (async () => {
      try {
        await renderShareCard(canvas, {
          track: card,
          lines,
          accentColor,
          format,
          seed: card.id,
        });
        if (!cancelled) setRendering(false);
      } catch {
        if (!cancelled) {
          setError("Could not render the share card.");
          setRendering(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, format, card, lines, accentColor]);

  /**
   * Mint a durable short link so the shared image carries somewhere to go.
   * A failure here is not fatal — the image is still worth sharing on its own,
   * so we degrade to an image-only share rather than blocking.
   */
  const createLink = async (): Promise<string | undefined> => {
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: lines.length ? "lyric" : "track",
          payload: {
            trackId: card.id,
            title: card.title,
            artist: card.artist,
            coverUrl: card.coverUrl,
            lines,
            // Lets the recipient land on the exact moment being quoted.
            startTime: lyricTime,
            accentColor,
          },
        }),
      });
      if (!res.ok) return undefined;
      const { url } = await res.json();
      return typeof url === "string" ? url : undefined;
    } catch {
      return undefined;
    }
  };

  const handleShare = async () => {
    if (!canvasRef.current) return;
    const blob = await canvasToBlob(canvasRef.current);
    if (!blob) {
      setError("Couldn't generate the image.");
      return;
    }

    const [url] = await Promise.all([createLink()]);

    const file = new File([blob], `${card.artist}-${card.title}.png`, { type: "image/png" });
    const text = lines.length
      ? `“${lines.join(" / ")}” — ${card.artist}`
      : `${card.title} — ${card.artist}`;

    // Some targets accept files but silently drop accompanying text, so the
    // richest combination is attempted first and narrowed on rejection.
    const attempts = [{ files: [file], text, url }, { files: [file] }, { text, url }];

    for (const data of attempts) {
      if (!navigator.canShare?.(data)) continue;
      try {
        await navigator.share(data);
        onClose();
        return;
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }

    // Fallback: clipboard.
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setError(null);
    } catch {
      // Download, as last resort.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    }
  };

  if (!open) return null;

  const canvasW = DIMENSIONS.story.w;
  const canvasH = DIMENSIONS.story.h;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-label="Share">
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>Share</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.preview}>
          {rendering && (
            <div className={styles.spinner}>
              <div className={styles.spinnerArc} />
              <span className={styles.spinnerLabel}>Rendering…</span>
            </div>
          )}
          {error && (
            <div className={styles.error}>{error}</div>
          )}
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            style={{
              width: "100%",
              maxHeight: "min(56vh, 22rem)",
              aspectRatio: `${canvasW} / ${canvasH}`,
              borderRadius: "12px",
              boxShadow: "0 8px 26px rgba(0,0,0,0.3)",
              background: "var(--sakura-surface)",
              opacity: rendering ? 0.3 : 1,
              transition: "opacity 0.3s",
              objectFit: "contain",
            }}
          />
        </div>

        <div className={styles.formats}>
          {FORMATS.map((f) => (
            <button
              key={f.key}
              className={`${styles.fmtBtn} ${format === f.key ? styles.fmtActive : ""}`}
              onClick={() => setFormat(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} onClick={handleShare} disabled={rendering}>
            {lines.length > 0 ? "Share lyric" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
