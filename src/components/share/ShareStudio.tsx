"use client";

import { useCallback, useMemo, useState } from "react";
import { Sheet } from "../Sheet";
import { ImageStep } from "./ImageStep";
import { VideoStep } from "./VideoStep";
import { useShare, type ShareSubject } from "./ShareContext";
import {
  copyLink,
  createShareLink,
  deliverShare,
  downloadBlob,
  shareFilename,
  type ShareOutcome,
} from "@/lib/shareDelivery";
import { ImageIcon, VideoIcon, LinkIcon, ArrowLeftIcon, CheckIcon } from "../Icons";
import { haptic } from "@/lib/haptics";
import styles from "./ShareStudio.module.css";

/**
 * The share studio.
 *
 * One sheet, three steps: pick a kind, build the thing, hand it over. It's
 * mounted once at the app root and driven by ShareContext, so every share site
 * in the app reaches the same flow rather than each rolling its own.
 *
 * Two decisions worth knowing:
 *
 * **Steps slide rather than swap.** The back path has to feel like retracing,
 * not like a new screen appearing, or the flow reads as a series of unrelated
 * dialogs.
 *
 * **The result step is separate from the build step.** Delivery can fail or be
 * cancelled independently of generation — a user who cancels the OS share
 * sheet still has a finished file, and throwing it away to make them re-encode
 * would be the wrong answer. So the blob is held and the result step offers
 * every remaining route to it.
 */

type Step = "choose" | "image" | "video" | "result";

interface Result {
  blob: Blob;
  filename: string;
  outcome: ShareOutcome;
  /** Landing page, when one was minted. */
  url?: string;
}

export function ShareStudio() {
  const { subject, closeShare } = useShare();
  const [step, setStep] = useState<Step>("choose");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const open = subject !== null;

  /*
   * Reset when a new share begins. A new share is always a fresh `subject`
   * object identity (every caller constructs one), so the "adjust state when a
   * prop changes" pattern keyed on that identity is enough — no effect, and no
   * stale card from the previous song left on screen.
   */
  const [prevSubject, setPrevSubject] = useState<ShareSubject | null>(null);
  if (subject !== prevSubject) {
    setPrevSubject(subject);
    setStep("choose");
    setResult(null);
    setBusy(false);
  }

  const lines = useMemo(
    () => (subject?.lines ?? []).map((l) => l.text).filter(Boolean),
    [subject?.lines]
  );

  /*
   * Lyric video needs *timed* lyrics, not just lyrics. The check is for
   * per-line timings rather than `isSynced`, because a track can carry plain
   * text under a shape that still reports as lyrics — and finding that out
   * after a 20-second export would be the worst possible moment.
   */
  const timedLines = useMemo(
    () => subject?.lyrics?.lines?.filter((l) => typeof l.time === "number") ?? [],
    [subject?.lyrics]
  );
  const canUseLyrics = timedLines.length > 0;

  const deliver = useCallback(
    async (blob: Blob, extension: string) => {
      if (!subject) return;
      setBusy(true);

      const filename = shareFilename(subject.track, extension);

      // Minted alongside the file rather than before it: a share the user
      // abandons mid-flow shouldn't leave a row in the database.
      const url = await createShareLink({
        kind: lines.length ? "lyric" : "track",
        trackId: subject.track.id,
        title: subject.track.title,
        artist: subject.track.artist,
        coverUrl: subject.track.coverUrl,
        lines,
        startTime: subject.atTime,
        accentColor: subject.accentColor,
      });

      const text = lines.length
        ? `“${lines.join(" / ")}” — ${subject.track.artist}`
        : `${subject.track.title} — ${subject.track.artist}`;

      const outcome = await deliverShare({
        blob,
        filename,
        text,
        url,
        title: subject.track.title,
      });

      setResult({ blob, filename, outcome, url });
      setStep("result");
      setBusy(false);
    },
    [subject, lines]
  );

  if (!subject) return null;

  const back = () => {
    haptic("selection");
    setStep(step === "result" ? "choose" : "choose");
  };

  const title =
    step === "choose"
      ? "Share"
      : step === "image"
        ? "Make an image"
        : step === "video"
          ? "Make a video"
          : "Ready";

  return (
    <Sheet
      open={open}
      onClose={closeShare}
      title={title}
      maxHeight="92dvh"
      headerAction={
        step !== "choose" ? (
          <button
            type="button"
            className={`${styles.backBtn} pressable`}
            onClick={back}
            aria-label="Back to share options"
          >
            <ArrowLeftIcon size={18} />
          </button>
        ) : undefined
      }
    >
      <div className={styles.root} data-step={step}>
        <p className={styles.subject}>
          <span className={styles.subjectTitle}>{subject.track.title}</span>
          <span className={styles.subjectArtist}>{subject.track.artist}</span>
        </p>

        {step === "choose" && (
          <ChooseStep
            hasLyrics={lines.length > 0}
            canUseLyrics={canUseLyrics}
            onPick={(next) => {
              haptic("selection");
              setStep(next);
            }}
            onCopyLink={async () => {
              setBusy(true);
              const url = await createShareLink({
                kind: lines.length ? "lyric" : "track",
                trackId: subject.track.id,
                title: subject.track.title,
                artist: subject.track.artist,
                coverUrl: subject.track.coverUrl,
                lines,
                startTime: subject.atTime,
                accentColor: subject.accentColor,
              });
              const outcome = url
                ? await copyLink(url)
                : ({ kind: "failed", message: "Couldn't create a link." } as ShareOutcome);
              setBusy(false);
              haptic(outcome.kind === "copied" ? "success" : "error");
              setResult({
                blob: new Blob(),
                filename: "",
                outcome,
                url,
              });
              setStep("result");
            }}
            busy={busy}
          />
        )}

        {step === "image" && (
          <ImageStep
            track={subject.track}
            lines={lines}
            accentColor={subject.accentColor ?? null}
            onExport={(blob) => deliver(blob, "png")}
            busy={busy}
          />
        )}

        {step === "video" && (
          <VideoStep
            track={subject.track}
            audioUrl={subject.track.audioUrl}
            lyricLines={timedLines}
            canUseLyrics={canUseLyrics}
            accentColor={subject.accentColor ?? null}
            atTime={subject.atTime}
            onExport={deliver}
          />
        )}

        {step === "result" && result && (
          <ResultStep result={result} onDone={closeShare} onRestart={() => setStep("choose")} />
        )}
      </div>
    </Sheet>
  );
}

/* ── Step 1 ──────────────────────────────────────────────────────────────── */

function ChooseStep({
  hasLyrics,
  canUseLyrics,
  onPick,
  onCopyLink,
  busy,
}: {
  hasLyrics: boolean;
  canUseLyrics: boolean;
  onPick: (step: "image" | "video") => void;
  onCopyLink: () => void;
  busy: boolean;
}) {
  return (
    <div className={styles.step}>
      <div className={styles.kinds}>
        <button
          type="button"
          className={`${styles.kind} pressable-lg`}
          onClick={() => onPick("image")}
        >
          <span className={styles.kindIcon}>
            <ImageIcon size={26} />
          </span>
          <span className={styles.kindLabel}>Image</span>
          <span className={styles.kindHint}>
            {hasLyrics ? "Five designs for the lyric you picked" : "Five designs to choose from"}
          </span>
        </button>

        <button
          type="button"
          className={`${styles.kind} pressable-lg`}
          onClick={() => onPick("video")}
        >
          <span className={styles.kindIcon}>
            <VideoIcon size={26} />
          </span>
          <span className={styles.kindLabel}>Video</span>
          <span className={styles.kindHint}>
            {canUseLyrics
              ? "A clip of the song, with the words in time"
              : "A clip of the song with the artwork"}
          </span>
        </button>
      </div>

      <button
        type="button"
        className={`${styles.linkRow} pressable`}
        onClick={onCopyLink}
        disabled={busy}
      >
        <LinkIcon size={18} />
        {busy ? "Making a link…" : "Just copy a link"}
      </button>
    </div>
  );
}

/* ── Final step ──────────────────────────────────────────────────────────── */

function ResultStep({
  result,
  onDone,
  onRestart,
}: {
  result: Result;
  onDone: () => void;
  onRestart: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { outcome, blob, filename, url } = result;

  const message =
    outcome.kind === "shared"
      ? "Shared."
      : outcome.kind === "copied"
        ? "Link copied."
        : outcome.kind === "downloaded"
          ? "Saved to your device."
          : outcome.kind === "cancelled"
            ? "Sharing cancelled — your file is still here."
            : outcome.message;

  const isProblem = outcome.kind === "failed";

  return (
    <div className={styles.step}>
      <div className={styles.resultHead}>
        {!isProblem && (
          <span className={styles.resultTick}>
            <CheckIcon size={22} />
          </span>
        )}
        <p className={styles.resultMessage}>{message}</p>
      </div>

      {/*
        Everything is still reachable. A cancelled OS share sheet, or a target
        that refused the file, must not mean re-encoding a video — the blob
        already exists, so every remaining route to it stays offered.
      */}
      <div className={styles.resultActions}>
        {blob.size > 0 && (
          <button
            type="button"
            className={`${styles.secondary} pressable`}
            onClick={() => {
              downloadBlob(blob, filename);
              setNote("Saved to your device.");
            }}
          >
            Save to device
          </button>
        )}

        {url && (
          <button
            type="button"
            className={`${styles.secondary} pressable`}
            onClick={async () => {
              const r = await copyLink(url);
              setNote(r.kind === "copied" ? "Link copied." : "Couldn't copy the link.");
            }}
          >
            Copy link
          </button>
        )}

        <button type="button" className={`${styles.secondary} pressable`} onClick={onRestart}>
          Make another
        </button>
      </div>

      {note && (
        <p className={styles.resultNote} role="status">
          {note}
        </p>
      )}

      <button type="button" className={`${styles.primary} pressable`} onClick={onDone}>
        Done
      </button>
    </div>
  );
}
