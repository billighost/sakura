"use client";
import { useState, useEffect } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  
  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  
  if (online) return null;
  
  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 400,
      background: "var(--sakura-warning)",
      color: "#000",
      textAlign: "center",
      padding: "0.375rem",
      fontSize: "0.75rem",
      fontWeight: 600,
    }}>
      You&apos;re offline — some features may be limited
    </div>
  );
}
