"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("contextmenu", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("contextmenu", handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    // Adjust position if it goes off screen
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const ww = window.innerWidth;
      const wh = window.innerHeight;

      let newX = x;
      let newY = y;
      if (x + rect.width > ww) newX = ww - rect.width - 10;
      if (y + rect.height > wh) newY = wh - rect.height - 10;

      menuRef.current.style.left = `${newX}px`;
      menuRef.current.style.top = `${newY}px`;
      setReady(true);
    }
  }, [x, y]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`${styles.menu} ${ready ? styles.menuOpen : ""}`}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
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
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      className={styles.item}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon && <span className={styles.itemIcon}>{icon}</span>}
      {children}
    </button>
  );
}
