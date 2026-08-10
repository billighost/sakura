"use client";

import { useEffect, useRef, useState } from "react";
import { useAppNav } from "./AppNavContext";
import { ChevronLeftIcon } from "./Icons";
import styles from "./PageHeader.module.css";

/**
 * The one header every page uses.
 *
 * Before this existed each page invented its own: Settings hand-rolled a back
 * button, the track page had a `BackButton.tsx` of its own, `Header.tsx` had a
 * centred title nothing imported, and several pages had no way back at all —
 * which in a standalone PWA (no browser chrome to fall back on) means the user
 * is genuinely stuck.
 *
 * Structure follows the platform large-title pattern, and the reason is
 * ergonomic rather than stylistic: the bar holding the back button is sticky
 * and permanent, so the one control the user needs to escape a page never
 * scrolls away, and it is never duplicated in the accessibility tree. Only the
 * *title* moves — the large one scrolls off, the compact one fades in to
 * replace it, cross-fading by opacity so neither state re-lays-out the header
 * and shifts the content underneath.
 */

export interface PageHeaderProps {
  title: string;
  /** Sits above the title — section name, item count, breadcrumb. */
  eyebrow?: string;
  /** Show a back control. Turn off for tab roots, which have nowhere to go. */
  showBack?: boolean;
  /** Where back goes when there's no history to pop (deep link, share landing). */
  backFallback?: string;
  /** Controls at the trailing edge of the sticky bar. */
  actions?: React.ReactNode;
  /** Rendered under the large title — a search field, filter chips. */
  children?: React.ReactNode;
  /** Skip the large title; the page is compact-only. */
  compactOnly?: boolean;
}

/** Scroll distance over which the large title gives way to the compact one. */
const COLLAPSE_PX = 44;

export function PageHeader({
  title,
  eyebrow,
  showBack = true,
  backFallback,
  actions,
  children,
  compactOnly = false,
}: PageHeaderProps) {
  const { back, getScroller } = useAppNav();
  const [collapsed, setCollapsed] = useState(compactOnly);
  const frame = useRef(0);

  useEffect(() => {
    if (compactOnly) return;
    const el = getScroller();
    if (!el) return;

    // rAF-coalesced: scroll fires far faster than this needs to re-render, and
    // a setState per event makes a long list stutter.
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setCollapsed(el.scrollTop > COLLAPSE_PX);
      });
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [getScroller, compactOnly]);

  return (
    <div className={`${styles.root} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.bar}>
        {showBack && (
          <button
            type="button"
            className={`${styles.iconBtn} pressable`}
            onClick={() => back(backFallback)}
            aria-label="Go back"
          >
            <ChevronLeftIcon size={22} />
          </button>
        )}

        {/*
          Hidden from assistive tech until it's the visible title — while
          expanded the <h1> below is the page's heading and this would be a
          duplicate announcement of the same string.
        */}
        <span className={styles.compactTitle} aria-hidden={!collapsed}>
          {title}
        </span>

        {actions && <div className={styles.actions}>{actions}</div>}
      </div>

      {!compactOnly && (
        <div className={styles.large}>
          <div className={styles.titleBlock}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <h1 className={styles.title}>{title}</h1>
          </div>
          {children && <div className={styles.extras}>{children}</div>}
        </div>
      )}
    </div>
  );
}
