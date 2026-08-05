"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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
      menuRef.current.style.opacity = "1";
    }
  }, [x, y]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        opacity: 0,
        backgroundColor: "var(--sakura-surface-2)",
        border: "1px solid var(--sakura-border)",
        borderRadius: "8px",
        padding: "4px 0",
        minWidth: "160px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        fontSize: "0.875rem",
        color: "var(--sakura-text)",
      }}
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
  icon 
}: { 
  onClick: () => void; 
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        width: "100%",
        padding: "10px 16px",
        background: "transparent",
        border: "none",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sakura-surface-1)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {icon && <span style={{ width: "16px", display: "flex", justifyContent: "center" }}>{icon}</span>}
      {children}
    </button>
  );
}
