"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 *
 * This one replaces the entire document, so it has to render its own <html>
 * and <body> and cannot rely on globals.css having loaded — hence the inline
 * styles and the self-contained colour values.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E0B0F",
          color: "#F5F0F2",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "22rem" }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: "0 auto 1rem",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #F2789F, #C9A6E0)",
            }}
          />
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.5rem", fontWeight: 600 }}>
            Sakura couldn&apos;t start
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              lineHeight: 1.55,
              color: "#A8A0A8",
              margin: "0 0 1.5rem",
            }}
          >
            Something went wrong while loading the app. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 1.5rem",
              borderRadius: 999,
              border: "none",
              background: "linear-gradient(135deg, #F2789F, #C9A6E0)",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
