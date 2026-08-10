"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/useFocusTrap";
import styles from "./ContextMenu.module.css";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible name for the menu. */
  label?: string;
}

/** Keeps the menu clear of the viewport edges and the app's bottom chrome. */
const EDGE_GAP = 10;

export function ContextMenu({ x, y, onClose, children, label = "Actions" }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useFocusTrap(menuRef, true);

  /*
   * Positioned in a layout effect, before paint. The previous version measured
   * in a passive effect and flipped a `ready` class afterwards, so the menu was
   * painted once at the raw touch point — off-screen near an edge — and then
   * jumped into place on the next frame.
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    setPos({
      left: Math.max(EDGE_GAP, Math.min(x, vw - rect.width - EDGE_GAP)),
      top: Math.max(EDGE_GAP, Math.min(y, vh - rect.height - EDGE_GAP)),
    });
  }, [x, y]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }

    // `pointerdown` rather than `mousedown`: on touch, mousedown is synthesised
    // ~300ms later (or not at all), so a tap outside left the menu open.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    // Any scroll or resize invalidates the anchor point entirely.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`${styles.menu} ${pos ? styles.menuOpen : ""}`}
      // Rendered at the raw point for the first measuring pass, but invisible
      // until `pos` lands — see the layout effect above.
      style={{ left: pos?.left ?? x, top: pos?.top ?? y }}
      role="menu"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body
  );
}

export function ContextMenuItem({
  onClick,
  children,
  icon,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  /** Destructive actions read differently. */
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${danger ? styles.itemDanger : ""} pressable`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon && (
        <span className={styles.itemIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
