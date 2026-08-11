"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon, SortIcon } from "./Icons";
import { haptic } from "@/lib/haptics";
import styles from "./CollectionControls.module.css";

/**
 * The controls shared by Library, Liked and Downloaded.
 *
 * All three had their own copy of the same three things — a search field, a
 * sort dropdown, and a filter row — which is roughly 400 lines of duplicated
 * markup and CSS across the three stylesheets. Worse than the duplication was
 * the drift: the sort menu existed in two variants, one of which trapped no
 * focus, closed on neither Escape nor an outside tap on iOS, and left the
 * button's `aria-expanded` permanently true.
 *
 * These are deliberately presentational. Each page still owns its own state and
 * its own persistence key, because what "recently added" means differs between
 * a library of albums and a list of liked songs.
 */

/* ── Search ──────────────────────────────────────────────────────────────── */

export function CollectionSearch({
  value,
  onChange,
  onClose,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Omit to render a permanently-open field. */
  onClose?: () => void;
  placeholder: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on mount rather than `autoFocus`: React's autoFocus fires before the
  // element is in its final position, so on iOS the keyboard opens and the
  // page scrolls to a field that then moves.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.search}>
      <SearchIcon size={16} />
      <input
        ref={inputRef}
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears first, closes second — two escapes to leave, which
          // is what every native search field does.
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (value) onChange("");
          else onClose?.();
        }}
        // `search` inputs get a UA-drawn clear button in WebKit that sits on
        // top of ours; suppressed in CSS.
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className={`${styles.searchClear} tapTarget`}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

/* ── Sort ────────────────────────────────────────────────────────────────── */

/**
 * Sort menu.
 *
 * A listbox rather than a `<select>`: it needs to show a tick against the
 * current value and match the app's surfaces, neither of which a native select
 * allows. That means owning the keyboard contract by hand — arrows to move,
 * Enter to choose, Escape to cancel, focus returned to the trigger — which the
 * two previous hand-rolled copies did not do at all.
 */
export function CollectionSort<K extends string>({
  value,
  labels,
  onChange,
}: {
  value: K;
  labels: Record<K, string>;
  onChange: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const keys = Object.keys(labels) as K[];
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, keys.indexOf(value)));

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    []
  );

  const choose = useCallback(
    (key: K) => {
      haptic("selection");
      onChange(key);
      close();
    },
    [onChange, close]
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          // Wrap, so holding an arrow never dead-ends at either edge.
          return (next + keys.length) % keys.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const key = keys[activeIndex];
        if (key) choose(key);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, keys, activeIndex, choose, close]);

  // Move real DOM focus with the active index so screen readers follow.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']")[activeIndex];
    el?.focus();
  }, [open, activeIndex]);

  return (
    <div className={styles.sortWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.sortBtn} pressable`}
        onClick={() => {
          setActiveIndex(Math.max(0, keys.indexOf(value)));
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <SortIcon size={14} />
        <span className={styles.sortLabel}>{labels[value]}</span>
        <ChevronDownIcon size={13} />
      </button>

      {open && (
        <>
          {/* Catches the outside tap. `pointerdown` rather than `click` so a
              scroll that starts outside the menu also dismisses it. */}
          <div
            className={styles.sortBackdrop}
            onPointerDown={() => close(false)}
            aria-hidden="true"
          />
          <div
            ref={listRef}
            id={listId}
            className={styles.sortMenu}
            role="listbox"
            aria-label="Sort by"
          >
            {keys.map((key, i) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={value === key}
                tabIndex={i === activeIndex ? 0 : -1}
                className={`${styles.sortOption} ${value === key ? styles.sortOptionActive : ""}`}
                onClick={() => choose(key)}
                onPointerEnter={() => setActiveIndex(i)}
              >
                {labels[key]}
                {value === key && <CheckIcon size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Filter chips ────────────────────────────────────────────────────────── */

/**
 * Segmented filter. A tablist rather than a row of buttons: these are mutually
 * exclusive views of one list, which is exactly what the tab role describes,
 * and it gets arrow-key navigation from the platform for free.
 */
export function CollectionFilter<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: { key: K; label: string; count?: number }[];
  onChange: (key: K) => void;
}) {
  return (
    <div className={`${styles.filters} no-scrollbar`} role="tablist" aria-label="Filter by type">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          className={`${styles.chip} ${value === opt.key ? styles.chipActive : ""} pressable`}
          onClick={() => {
            haptic("selection");
            onChange(opt.key);
          }}
        >
          {opt.label}
          {opt.count !== undefined && opt.count > 0 && (
            <span className={styles.chipCount}>{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
