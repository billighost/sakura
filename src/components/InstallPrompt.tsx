"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Sheet } from "./Sheet";
import { CheckIcon, CloseIcon, DownloadedIcon, PlusIcon, ShareUpIcon } from "./Icons";
import { haptic } from "@/lib/haptics";
import {
  currentMoment,
  installRoute,
  isIPad,
  promptInstall,
  serverSnapshot,
  snapshot,
  snooze,
  subscribe,
  touchDay,
  type InstallMoment,
} from "@/lib/installPrompt";
import styles from "./InstallPrompt.module.css";

/**
 * The install offer.
 *
 * `lib/installPrompt.ts` decides *whether* to ask and holds the reasoning; this
 * file is only concerned with how the ask looks and what it costs to decline.
 *
 * Shape: a card that rises above the bottom chrome rather than a banner that
 * pushes the page down or a modal that blocks it. It never covers the mini
 * player or the tab bar, so at no point does the app stop working while the
 * offer is on screen — which is the practical difference between "non-intrusive"
 * and "small".
 *
 * On Chromium the primary button goes straight to the native dialog: the
 * browser is about to explain what installing means, so we shouldn't. On iOS
 * Safari, where no such API exists, it opens a sheet that shows the two taps
 * involved, because "Share → Add to Home Screen" is only obvious to people who
 * already know it.
 */

const COPY: Record<InstallMoment, { title: string; body: string }> = {
  download: {
    title: "Keep your downloads one tap away",
    body: "Add Sakura to your home screen and everything you've saved opens straight into the player — no browser, no signal needed.",
  },
  listening: {
    title: "Put Sakura on your home screen",
    body: "Opens full screen, picks up where you left off, and keeps playing when you lock the phone.",
  },
};

export function InstallPrompt() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  /* Set the moment the card is acted on, so it can animate out before it goes. */
  const [leaving, setLeaving] = useState(false);

  // One write per session, on mount: this is the "opened the app today" mark
  // that the two-distinct-days gate is built on.
  useEffect(touchDay, []);

  const moment = currentMoment();
  const route = installRoute();

  const dismiss = useCallback(() => {
    haptic("selection");
    setLeaving(true);
    // Long enough for the exit transition; the snooze write is what actually
    // removes it, so a missed timer degrades to "stays until next render".
    setTimeout(() => {
      snooze();
      setLeaving(false);
    }, 220);
  }, []);

  const accept = useCallback(async () => {
    haptic("impact");

    if (route === "ios-safari") {
      setWalkthroughOpen(true);
      return;
    }

    const installed = await promptInstall();
    if (installed) {
      haptic("success");
      return;
    }
    // Declining the browser's own dialog is a "no" and gets the same snooze a
    // dismissal would — asking again next session would be nagging.
    snooze();
  }, [route]);

  // `state` is read only to subscribe to the store; the values above are the
  // live read. Referencing it keeps the dependency honest to the linter.
  void state;

  if (!moment) return null;

  const copy = COPY[moment];

  return (
    <>
      <div
        className={`${styles.card} ${leaving ? styles.leaving : ""}`}
        role="dialog"
        aria-label="Install Sakura"
      >
        <div className={styles.icon} aria-hidden="true">
          {moment === "download" ? <DownloadedIcon size={22} /> : <PlusIcon size={22} />}
        </div>

        <div className={styles.text}>
          <p className={styles.title}>{copy.title}</p>
          <p className={styles.body}>{copy.body}</p>
        </div>

        <div className={styles.actions}>
          <button type="button" className={`${styles.primary} pressable`} onClick={accept}>
            {route === "ios-safari" ? "Show me how" : "Add to home screen"}
          </button>
          <button type="button" className={`${styles.secondary} pressable`} onClick={dismiss}>
            Not now
          </button>
        </div>

        <button
          type="button"
          className={`${styles.close} pressable`}
          onClick={dismiss}
          aria-label="Dismiss install suggestion"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <IOSWalkthrough open={walkthroughOpen} onClose={() => setWalkthroughOpen(false)} />
    </>
  );
}

/**
 * iOS has no install API, so the only honest thing to do is admit that and
 * point at the two controls involved.
 *
 * The illustrations matter more than the words here. People don't read "tap the
 * Share button" and picture the right glyph — they scan the toolbar for a shape.
 * So each step draws the actual control at roughly the size and position iOS
 * puts it, including which edge of the screen to look at, which differs between
 * iPhone (bottom toolbar) and iPad (top right).
 */
function IOSWalkthrough({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ipad = isIPad();

  return (
    <Sheet open={open} onClose={onClose} title="Add to Home Screen">
      <p className={styles.lede}>
        Safari doesn&apos;t let apps install themselves, so this part is manual —
        three taps, once.
      </p>

      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.stepNum} aria-hidden="true">
            1
          </span>
          <div className={styles.stepBody}>
            <p className={styles.stepTitle}>
              Tap Share {ipad ? "at the top right" : "in the bar at the bottom"}
            </p>
            <p className={styles.stepNote}>
              The square with an arrow pointing out of it.
            </p>

            {/* A mock of Safari's toolbar with the share control called out. */}
            <div
              className={`${styles.mock} ${ipad ? styles.mockTop : ""}`}
              aria-hidden="true"
            >
              <span className={styles.mockGhost} />
              <span className={styles.mockGhost} />
              <span className={`${styles.mockKey} ${styles.mockHighlight}`}>
                <ShareUpIcon size={20} />
              </span>
              <span className={styles.mockGhost} />
              <span className={styles.mockGhost} />
            </div>
          </div>
        </li>

        <li className={styles.step}>
          <span className={styles.stepNum} aria-hidden="true">
            2
          </span>
          <div className={styles.stepBody}>
            <p className={styles.stepTitle}>Scroll down to Add to Home Screen</p>
            <p className={styles.stepNote}>
              It sits below the row of apps, past Add Bookmark.
            </p>

            {/* A mock of the share sheet row iOS shows for this action. */}
            <div className={styles.mock} aria-hidden="true">
              <span className={styles.mockRow}>
                <span className={styles.mockRowLabel}>Add to Home Screen</span>
                <span className={styles.mockRowIcon}>
                  <PlusIcon size={16} />
                </span>
              </span>
            </div>
          </div>
        </li>

        <li className={styles.step}>
          <span className={styles.stepNum} aria-hidden="true">
            3
          </span>
          <div className={styles.stepBody}>
            <p className={styles.stepTitle}>Tap Add</p>
            <p className={styles.stepNote}>
              Sakura lands on your home screen and opens without Safari&apos;s
              chrome from then on.
            </p>

            <div className={styles.mock} aria-hidden="true">
              <span className={styles.mockRow}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.mockAppIcon}
                  src="/icons/icon-transparent-192.png"
                  alt=""
                  width={30}
                  height={30}
                />
                <span className={styles.mockRowLabel}>Sakura</span>
                <span className={styles.mockAdd}>
                  <CheckIcon size={14} />
                  Add
                </span>
              </span>
            </div>
          </div>
        </li>
      </ol>
    </Sheet>
  );
}
