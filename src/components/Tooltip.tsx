"use client";

import { useId } from "react";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  /** What the control does, in the imperative. Keep it to two or three words. */
  label: string;
  /**
   * The keyboard shortcut that does the same thing, if there is one. Rendered as
   * a key cap beside the label.
   */
  shortcut?: string;
  placement?: "top" | "bottom";
  /**
   * Nudges the bubble left or right of centre, in pixels. For controls at the
   * very edge of the screen, whose centred bubble would otherwise be clipped by
   * the player's `overflow: hidden`.
   */
  offsetX?: number;
  children: React.ReactNode;
}

/**
 * A hover/focus label for an icon-only control.
 *
 * ── Why a component and not the `title` attribute ───────────────────────────
 *
 * `title` is the cheap answer and it's a bad one here: the browser's own tooltip
 * takes about a second to appear, can't be styled to match a surface that sits on
 * artwork, and — the part that matters for this app — never appears on touch,
 * *including* for keyboard users on a touch-capable laptop. This shows on hover
 * and on `:focus-visible`, so tabbing through the player names each control.
 *
 * ── Why it's pointer-fine only ──────────────────────────────────────────────
 *
 * On a phone there is no hover, so a tooltip can only fire on tap — at which
 * point the action has already happened and the label is explaining something
 * the user just did. The whole thing is scoped inside
 * `@media (hover: hover) and (pointer: fine)` in the stylesheet; on touch it
 * costs a wrapper span and draws nothing.
 *
 * ── Accessibility ──────────────────────────────────────────────────────────
 *
 * The bubble is `aria-hidden` and the wrapped control keeps its own
 * `aria-label`. Wiring this up as `aria-describedby` instead would make a screen
 * reader announce the same words twice — once as the button's name, once as its
 * description — since a tooltip on an icon button almost always repeats the
 * name. The visible text is for sighted pointer users; the accessible name is
 * already doing this job for everyone else.
 *
 * `shortcut` is worth showing because these keys already work and nothing in the
 * app says so (see lib/useKeyboardShortcuts.ts). A tooltip that teaches
 * something is worth its screen time; one that reads the icon back to you isn't.
 */
export function Tooltip({
  label,
  shortcut,
  placement = "top",
  offsetX = 0,
  children,
}: TooltipProps) {
  const id = useId();

  return (
    <span className={styles.wrap}>
      {children}
      <span
        id={id}
        role="presentation"
        aria-hidden="true"
        className={styles.bubble}
        data-placement={placement}
        style={offsetX ? { "--offset-x": `${offsetX}px` } as React.CSSProperties : undefined}
      >
        {label}
        {shortcut && <kbd className={styles.key}>{shortcut}</kbd>}
      </span>
    </span>
  );
}
