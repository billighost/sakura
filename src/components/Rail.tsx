"use client";

import Link from "next/link";
import { ChevronRightIcon } from "./Icons";
import styles from "./Rail.module.css";

/**
 * A titled horizontal scroller.
 *
 * The section header used to be re-declared per rail — same markup, four
 * stylesheets, and one of them had a "See all" link that went nowhere. Here the
 * link is optional and only rendered when there's somewhere real to go, which
 * is the only way to hold the house rule about never shipping a dead control.
 *
 * `.snap-x` and `.no-scrollbar` come from globals.css: rails snap like a native
 * carousel and never draw a scrollbar over the artwork.
 */
export function Rail({
  title,
  eyebrow,
  href,
  children,
}: {
  title: string;
  /** Small label above the title — "Because you listened to…". */
  eyebrow?: string;
  /** Adds a "See all" affordance. Omit when there is no full list. */
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.titles}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 className={styles.title}>{title}</h2>
        </div>

        {href && (
          <Link href={href} className={`${styles.more} pressable`}>
            See all
            <ChevronRightIcon size={15} />
          </Link>
        )}
      </header>

      {/* The rail bleeds into the page gutter so cards scroll to the very edge
          of the screen rather than stopping short inside a padded box. */}
      <div className={`${styles.rail} snap-x no-scrollbar anim-stagger`}>{children}</div>
    </section>
  );
}

/** A rail's non-scrolling sibling, for sections that read better as a grid. */
export function Grid({
  title,
  eyebrow,
  href,
  columns = "auto",
  children,
}: {
  title?: string;
  eyebrow?: string;
  href?: string;
  /** `auto` fits as many as the width allows; `2` pins a two-up layout. */
  columns?: "auto" | "2";
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      {title && (
        <header className={styles.header}>
          <div className={styles.titles}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <h2 className={styles.title}>{title}</h2>
          </div>
          {href && (
            <Link href={href} className={`${styles.more} pressable`}>
              See all
              <ChevronRightIcon size={15} />
            </Link>
          )}
        </header>
      )}

      <div
        className={`${styles.grid} ${columns === "2" ? styles.grid2 : ""} anim-stagger`}
      >
        {children}
      </div>
    </section>
  );
}
