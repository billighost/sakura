"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canvasToBlob,
  renderShareCard,
  VARIANTS,
  type CardFormat,
  type CardTrack,
  type CardVariant,
} from "@/lib/shareCard";
import { haptic } from "@/lib/haptics";
import styles from "./ShareStudio.module.css";

/**
 * Image step: pick a composition, pick a shape, export.
 *
 * Previews render at a fraction of export resolution. A 1080×1920 canvas per
 * variant, redrawn on every prop change, is ~2M pixels of fill and text
 * measurement each — enough to drop frames on a phone while the user is
 * flicking through options. Export resolution is only paid once, on the blob
 * the user actually asked for.
 */

/**
 * Preview scale. 0.32 of 1080 is ~346px wide — comfortably above the ~200px
 * the preview is displayed at on a phone even at 3× DPR, so it stays crisp
 * without rendering four times the pixels anyone will see.
 */
const PREVIEW_SCALE = 0.32;

const FORMATS: { key: CardFormat; label: string; hint: string }[] = [
  { key: "story", label: "Story", hint: "9:16, for Stories and Reels" },
  { key: "square", label: "Post", hint: "1:1, for feeds" },
  { key: "landscape", label: "Link", hint: "For link previews" },
];

export interface ImageStepProps {
  track: CardTrack;
  lines: string[];
  accentColor: string | null;
  /** Called with the finished full-resolution image. */
  onExport: (blob: Blob, meta: { variant: CardVariant; format: CardFormat }) => void;
  busy?: boolean;
}

export function ImageStep({ track, lines, accentColor, onExport, busy }: ImageStepProps) {
  const [variant, setVariant] = useState<CardVariant>(lines.length ? "quote" : "sleeve");
  const [format, setFormat] = useState<CardFormat>("story");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Depend on the primitives, not the object: a parent that rebuilds `track`
  // on every render would otherwise re-trigger a full canvas redraw per commit.
  const { id, title, artist, album, coverUrl } = track;
  const card = useMemo<CardTrack>(
    () => ({ id, title, artist, album, coverUrl }),
    [id, title, artist, album, coverUrl]
  );

  // Joined for the dependency array — a fresh array identity each render would
  // redraw continuously.
  const lineKey = lines.join("\n");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setRendering(true);
    setError(null);

    (async () => {
      try {
        await renderShareCard(canvas, {
          track: card,
          variant,
          lines: lineKey ? lineKey.split("\n") : [],
          accentColor,
          format,
          scale: PREVIEW_SCALE,
        });
        if (!cancelled) setRendering(false);
      } catch {
        if (!cancelled) {
          setError("Couldn't draw this design. Try another one.");
          setRendering(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [card, variant, format, lineKey, accentColor]);

  const handleExport = useCallback(async () => {
    setError(null);
    try {
      // Full resolution, drawn offscreen so the on-screen preview doesn't
      // flash at export size before the blob is taken.
      const full = document.createElement("canvas");
      await renderShareCard(full, {
        track: card,
        variant,
        lines: lineKey ? lineKey.split("\n") : [],
        accentColor,
        format,
        scale: 1,
      });

      const blob = await canvasToBlob(full);
      if (!blob) {
        // Almost always a tainted canvas — say something the user can act on
        // rather than "export failed".
        setError("Couldn't save this image. The artwork may not have loaded.");
        return;
      }

      haptic("success");
      onExport(blob, { variant, format });
    } catch {
      setError("Couldn't save this image.");
    }
  }, [card, variant, format, lineKey, accentColor, onExport]);

  const dims = format === "story" ? [9, 16] : format === "square" ? [1, 1] : [1200, 630];

  return (
    <div className={styles.step}>
      <div className={styles.previewFrame}>
        <canvas
          ref={canvasRef}
          className={styles.previewCanvas}
          style={{ aspectRatio: `${dims[0]} / ${dims[1]}` }}
          // The canvas is a picture of the card; its content is described by
          // the controls beside it, so a name is enough.
          role="img"
          aria-label={`${VARIANTS.find((v) => v.key === variant)?.label} design preview`}
          data-rendering={rendering ? "true" : undefined}
        />
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.pickerGroup}>
        <p className={styles.pickerLabel} id="design-label">
          Design
        </p>
        <div className={`${styles.chipRow} no-scrollbar`} role="radiogroup" aria-labelledby="design-label">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={variant === v.key}
              className={`${styles.chip} ${variant === v.key ? styles.chipActive : ""} pressable`}
              onClick={() => {
                haptic("selection");
                setVariant(v.key);
              }}
            >
              <span className={styles.chipLabel}>{v.label}</span>
              <span className={styles.chipHint}>{v.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.pickerGroup}>
        <p className={styles.pickerLabel} id="shape-label">
          Shape
        </p>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="shape-label">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={format === f.key}
              title={f.hint}
              className={`${styles.segment} ${format === f.key ? styles.segmentActive : ""} pressable`}
              onClick={() => {
                haptic("selection");
                setFormat(f.key);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`${styles.primary} pressable`}
        onClick={handleExport}
        disabled={busy || rendering}
      >
        {busy ? "Preparing…" : "Share this image"}
      </button>
    </div>
  );
}
