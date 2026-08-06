"use client";

import React from "react";

interface PullToRefreshSpinnerProps {
  pullDistance: number;
  refreshing: boolean;
  threshold?: number;
}

export function PullToRefreshSpinner({
  pullDistance,
  refreshing,
  threshold = 70,
}: PullToRefreshSpinnerProps) {
  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(1, pullDistance / threshold);
  const rotation = progress * 360;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        pointerEvents: "none",
        transform: `translateY(${Math.min(pullDistance - 50, 10)}px)`,
        opacity: refreshing ? 1 : progress,
        transition: refreshing ? "transform 0.2s, opacity 0.2s" : "none",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: "var(--sakura-glass-strong)",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--sakura-glass-border)",
          boxShadow: "0 4px 16px var(--sakura-shadow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {refreshing ? (
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              border: "2px solid var(--sakura-border)",
              borderTopColor: "var(--sakura-accent)",
              animation: "ptr-spin 0.8s linear infinite",
            }}
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--sakura-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              width: "18px",
              height: "18px",
              transform: `rotate(${rotation}deg)`,
              transition: "transform 0.1s linear",
            }}
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        )}
      </div>

      <style jsx global>{`
        @keyframes ptr-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
