import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sakura",
};

/**
 * Frame for the public policy pages (/about, /privacy, /terms).
 *
 * The Back link points at `/` rather than `/settings`, and that matters because
 * these pages are public: they're linked from the login and register screens as
 * well as from Settings. A signed-out reader who followed one from /login and
 * then tapped "Back to settings" was sent to a route the proxy guards, so they
 * landed on /login with no explanation of why.
 *
 * `/` already resolves this correctly with no session read of its own — it
 * redirects to /home when signed in and /login when not — so one static link
 * serves both audiences and this layout stays fully prerenderable.
 */
export default function StaticLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "var(--sakura-bg)" }}>
      <header style={{
        display: "flex",
        alignItems: "center",
        height: "clamp(2.75rem, 8vh, 3.5rem)",
        padding: "0 clamp(0.5rem, 2vw, 1rem)",
        background: "var(--sakura-bg)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}>
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.375rem 0.75rem",
            borderRadius: "9999px",
            color: "var(--sakura-text-secondary)",
            textDecoration: "none",
            fontSize: "0.8125rem",
            fontWeight: 500,
          }}
          aria-label="Back to Sakura"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Back</span>
        </Link>
      </header>
      {children}
    </div>
  );
}
