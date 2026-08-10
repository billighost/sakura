"use client";

import { useCallback, useMemo, useState } from "react";
import { setCachedLyrics } from "@/lib/offline-db";
import {
  detectLyricScript,
  SCRIPT_LABELS,
  type LyricData,
  type LyricScript,
} from "@/lib/lyrics";
import { haptic } from "@/lib/haptics";
import { LanguageIcon, SpinnerIcon } from "./Icons";
import styles from "./TransliterateControl.module.css";

/**
 * "Show romanised" for lyrics in a non-Latin script.
 *
 * Three states, and which one you get is decided by the data rather than by a
 * setting:
 *
 *   Latin lyrics            → nothing renders. Offering to romanise an English
 *                             song is noise, and this control sits directly
 *                             above the words, so noise here is expensive.
 *   Romanisation present    → a visibility toggle. Provider-supplied
 *                             romanisations are human-checked, so when one
 *                             exists there is nothing to generate.
 *   Non-Latin, none present → a button that generates one.
 *
 * Detection is by script ratio, not by "contains a non-Latin character" — see
 * `detectScript`. An English song with one stray CJK glyph in a title must not
 * trigger the offer.
 */

interface Props {
  track: { id: string; title: string; artist: string };
  lyrics: LyricData;
  onTransliterated: (data: LyricData) => void;
  /** Whether the romanisation is currently shown beneath each line. */
  visible: boolean;
  onVisibilityChange: (visible: boolean) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export function TransliterateControl({
  track,
  lyrics,
  onTransliterated,
  visible,
  onVisibilityChange,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Sampled across the whole lyric set rather than per line: a single line can
  // be entirely English inside an otherwise Japanese song.
  const info = useMemo(() => detectLyricScript(lyrics), [lyrics]);
  const hasTransliteration = Boolean(lyrics.hasTransliteration);

  const generate = useCallback(async () => {
    const lines = lyrics.lines;
    if (!lines?.length || !info.worthTransliterating) return;

    setStatus({ kind: "loading" });

    try {
      const res = await fetch("/api/transliterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: track.id,
          script: info.script,
          lines: lines.map((l) => l.text),
        }),
      });

      if (!res.ok) {
        // The endpoint's messages are already written for a reader — pass them
        // through rather than replacing them with something vaguer.
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ??
            (res.status === 429
              ? "Too many requests just now. Try again in a minute."
              : "Couldn't romanise these lyrics.")
        );
      }

      const result: { lines: string[]; quality?: { note?: string } } = await res.json();
      if (!Array.isArray(result.lines) || result.lines.length !== lines.length) {
        throw new Error("Couldn't romanise these lyrics.");
      }

      const merged: LyricData = {
        ...lyrics,
        lines: lines.map((line, i) => ({
          ...line,
          transliterated: result.lines[i] || undefined,
        })),
        hasTransliteration: true,
      };

      // Written straight to the offline cache so the romanisation survives a
      // reload and is there offline — regenerating it on every open would be
      // the same work for the same answer.
      await setCachedLyrics(track.id, merged);

      onTransliterated(merged);
      onVisibilityChange(true);
      setStatus({ kind: "idle" });
      haptic("success");
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't romanise these lyrics.",
      });
      haptic("error");
    }
  }, [lyrics, info, track.id, onTransliterated, onVisibilityChange]);

  // Nothing to offer: Latin script, or no timed lines to attach a romanisation
  // to. Plain-text lyrics have no per-line structure to stack it against.
  if (!lyrics.lines?.length) return null;
  if (!hasTransliteration && !info.worthTransliterating) {
    return info.script !== "latin" && info.ratio > 0.2 ? (
      <div className={styles.bar}>
        <p className={styles.unsupported}>
          Sakura can&rsquo;t romanise {SCRIPT_LABELS[info.script as LyricScript]} yet.
        </p>
      </div>
    ) : null;
  }

  if (hasTransliteration) {
    return (
      <div className={styles.bar}>
        <button
          type="button"
          className={`${styles.toggle} ${visible ? styles.toggleOn : ""} pressable`}
          onClick={() => {
            haptic("selection");
            onVisibilityChange(!visible);
          }}
          aria-pressed={visible}
        >
          <LanguageIcon size={16} />
          {visible ? "Hide romanisation" : "Show romanisation"}
        </button>
      </div>
    );
  }

  const loading = status.kind === "loading";

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={`${styles.toggle} pressable`}
        onClick={generate}
        disabled={loading}
        // The label names the script, because "Get transliteration" assumes the
        // reader knows what that word means about the song they're looking at.
        aria-label={`Show ${SCRIPT_LABELS[info.script as LyricScript]} lyrics in the Latin alphabet`}
      >
        {loading ? <SpinnerIcon size={16} /> : <LanguageIcon size={16} />}
        {loading ? "Romanising…" : "Show in Latin letters"}
      </button>

      {status.kind === "error" && (
        <p className={styles.error} role="status">
          {status.message}
        </p>
      )}
    </div>
  );
}
