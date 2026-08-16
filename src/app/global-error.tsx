"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 *
 * This one replaces the entire document, so it renders its own <html> and <body>
 * and cannot rely on globals.css having loaded — hence inline styles and literal
 * colour values rather than tokens.
 *
 * ── Why the values are duplicated here ────────────────────────────────────
 *
 * They're copied from the dark palette in globals.css. That duplication is
 * deliberate and it's the reason this file exists in this shape: the one thing
 * this screen must survive is the stylesheet not arriving. If the numbers here
 * drift from the palette, the worst outcome is that the most-broken screen in the
 * app looks slightly off — which is a far better failure than a white page.
 *
 * The two 135° pink→purple gradients that used to fill the glyph and the button
 * are gone. They were the loudest remaining instance of the exact treatment the
 * design language removes, sitting on the one screen a user sees when everything
 * else has failed.
 */

/* Mirrors --bg, --surface-3, --text, --text-2, --line-strong, --accent,
 * --accent-press and --on-accent from the dark palette. */
const INK = "#0c0a0d";
const SURFACE = "#262029";
const TEXT = "#f6f3f6";
const TEXT_2 = "#a79fa9";
const LINE = "#383040";
const ACCENT = "#ef6d97";
const ON_ACCENT = "#17070e";

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
          padding: "1.5rem",
          background: INK,
          color: TEXT,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <main style={{ maxWidth: "24rem" }}>
          {/*
            The blossom, drawn inline. Five petals, flat accent fill — the same
            mark as the rest of the app rather than the coloured circle this
            replaces, and it can't fail to load because it isn't a file.
          */}
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill={ACCENT}
            aria-hidden="true"
            style={{ display: "block", marginBottom: "1.25rem" }}
          >
            {[0, 72, 144, 216, 288].map((deg) => (
              <path
                key={deg}
                d="M12 12.2c-1.85-1.15-2.9-2.9-2.9-4.7 0-1.75 1.3-3.1 2.9-3.1s2.9 1.35 2.9 3.1c0 1.8-1.05 3.55-2.9 4.7Z"
                transform={`rotate(${deg} 12 12)`}
              />
            ))}
            <circle cx="12" cy="12" r="1.5" fill={ON_ACCENT} />
          </svg>

          <h1
            style={{
              margin: "0 0 0.625rem",
              // Georgia stands in for Fraunces: the webfont hasn't loaded either.
              fontFamily: "ui-serif, Georgia, 'Times New Roman', serif",
              fontSize: "1.75rem",
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.022em",
            }}
          >
            Sakura couldn&apos;t start
          </h1>

          <p
            style={{
              margin: "0 0 1.75rem",
              fontSize: "0.9375rem",
              lineHeight: 1.55,
              color: TEXT_2,
            }}
          >
            Something went wrong loading the app. Reloading almost always fixes it.
            Anything you&apos;ve downloaded is still on your device.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              onClick={reset}
              style={{
                minHeight: 48,
                padding: "0 1.75rem",
                border: "none",
                borderRadius: 999,
                background: ACCENT,
                color: ON_ACCENT,
                fontSize: "0.9375rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload
            </button>

            {/*
              A plain anchor, not reset(): if the failure is in the root layout,
              re-rendering it can fail the same way forever. A real navigation to
              the downloads page is the one route guaranteed to work with no
              network and no server, because the service worker holds it.
            */}
            <a
              href="/library/downloaded"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 48,
                padding: "0 1.5rem",
                border: `1px solid ${LINE}`,
                borderRadius: 999,
                background: SURFACE,
                color: TEXT,
                fontSize: "0.9375rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Open my downloads
            </a>
          </div>

          {error.digest && (
            <p
              style={{
                margin: "1.75rem 0 0",
                fontSize: "0.75rem",
                color: TEXT_2,
              }}
            >
              If you report this, quote{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </code>
              .
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
