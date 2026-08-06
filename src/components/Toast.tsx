"use client";

import React, { useEffect } from "react";
import styles from "./Toast.module.css";

interface ToastProps {
  message: string;
  type?: "accent" | "error" | "success";
  visible: boolean;
  onClose: () => void;
  duration?: number;
}

export function Toast({
  message,
  type = "accent",
  visible,
  onClose,
  duration = 3000,
}: ToastProps) {
  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [visible, duration, onClose]);

  const typeClass =
    type === "error"
      ? styles.error
      : type === "success"
      ? styles.success
      : styles.accent;

  return (
    <div
      className={`${styles.toast} ${visible ? styles.visible : ""} ${typeClass}`}
      role="alert"
      aria-live="assertive"
    >
      {message}
    </div>
  );
}
