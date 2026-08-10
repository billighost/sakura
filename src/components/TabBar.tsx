"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { useAppNav } from "./AppNavContext";
import { haptic } from "@/lib/haptics";
import { HomeIcon, SearchIcon, LibraryIcon, UserIcon, type IconProps } from "./Icons";
import styles from "./TabBar.module.css";

/**
 * The tab bar.
 *
 * It used to hand-roll four inline SVGs, two of which were byte-identical
 * between their active and inactive states, so "selected" was carried by colour
 * alone. They now come from the icon system, which has real filled variants and
 * per-icon animation via `[data-anim]`.
 *
 * Two behavioural fixes worth naming:
 *
 *  - Tapping the active tab scrolled nothing. It called `window.scrollTo`, but
 *    the app shell scrolls an inner element — the window has never scrolled at
 *    all — so the gesture was inert on every tab. It now goes through the one
 *    registered scroller.
 *  - Switching tabs pushed a history entry each time, so Back walked the user
 *    through every tab they'd visited instead of leaving the section. Tabs are
 *    siblings, not a stack, so they replace.
 */

interface Tab {
  href: string;
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
}

const TABS: Tab[] = [
  { href: "/home", label: "Home", Icon: HomeIcon },
  { href: "/search", label: "Search", Icon: SearchIcon },
  { href: "/library", label: "Library", Icon: LibraryIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

export function TabBar() {
  const pathname = usePathname();
  const { navigate, scrollToTop } = useAppNav();

  const activeIndex = TABS.findIndex((t) => pathname.startsWith(t.href));

  const handleClick = useCallback(
    (e: React.MouseEvent, href: string, isActive: boolean) => {
      // Always ours to handle: <Link> is kept for the real href (middle-click,
      // "open in new tab", and a crawlable/keyboard-reachable anchor) but the
      // navigation itself goes through the shell so it gets a transition.
      e.preventDefault();
      haptic("selection");

      if (isActive) {
        scrollToTop();
        return;
      }
      navigate(href, "tab");
    },
    [navigate, scrollToTop]
  );

  return (
    <nav className={styles.bar} aria-label="Main">
      {/*
        One indicator that slides between tabs, rather than a dot mounted per
        tab. A remounted dot can only fade; a single element can travel, which
        is what makes the selection read as one thing moving.
      */}
      {activeIndex >= 0 && (
        <span
          className={styles.indicator}
          style={{
            width: `${100 / TABS.length}%`,
            // Translating by its own width per tab keeps it aligned whatever
            // the viewport, with no measurement and no resize listener.
            transform: `translateX(${activeIndex * 100}%)`,
          }}
          aria-hidden="true"
        />
      )}

      {TABS.map(({ href, label, Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.item} ${active ? styles.active : ""}`}
            aria-current={active ? "page" : undefined}
            data-anim={active ? "on" : undefined}
            onClick={(e) => handleClick(e, href, active)}
          >
            <span className={styles.iconWrap}>
              <Icon size={24} filled={active} />
            </span>
            <span className={styles.label}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
