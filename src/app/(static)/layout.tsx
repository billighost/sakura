import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sakura",
};

export default function StaticLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--sakura-bg)" }}>
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
          href="/settings"
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
          aria-label="Back to settings"
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
