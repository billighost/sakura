import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { SWRegister } from "@/components/SWRegister";
import { OfflineBanner } from "@/components/OfflineBanner";
import { LogoLoader } from "@/components/LogoLoader";

/**
 * Self-hosted via next/font rather than a <link> to fonts.googleapis.com.
 *
 * The stylesheet link was render-blocking on a third-party origin: two extra
 * DNS+TLS handshakes before the first paint, a flash of unstyled text after
 * it, and — the part that mattered most here — no fonts at all offline, since
 * the service worker can only cache the request after it has succeeded once.
 * next/font inlines the @font-face rules and serves the files from our own
 * origin, so they're covered by the normal asset cache.
 *
 * `display: swap` keeps text readable during the swap; `preload` is left on
 * for the body face only, since the display face is used for headings that
 * are never in the first paint's critical path.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Sakura",
  description: "Your personal music library",
  manifest: "/manifest.json",
  referrer: "no-referrer",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sakura",
  },
};

export const viewport: Viewport = {
  // Two entries so the browser/OS chrome matches the active theme instead of
  // always rendering the dark colour behind a light UI.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0E0B0F" },
    { media: "(prefers-color-scheme: light)", color: "#FAF8FA" },
  ],
  width: "device-width",
  initialScale: 1,
  // `maximumScale: 1` + `userScalable: false` used to be here. Blocking pinch
  // zoom is a WCAG 1.4.4 failure and locks out anyone who needs to magnify —
  // and iOS has ignored it since 10 anyway. The only thing it bought was
  // suppressing the 300ms double-tap-zoom delay, which `touch-action:
  // manipulation` on body (see globals.css) handles without the cost.
  viewportFit: "cover",
};

/**
 * Applies the saved theme before first paint.
 *
 * This has to be a blocking inline script in <head>: doing it in a `useEffect`
 * (where it lived) means the document renders once with the default dark
 * palette and then repaints, so every light-mode user saw a dark flash on
 * every navigation that remounted the shell.
 *
 * "system" is a stored value, not a palette, so it has to be resolved to an
 * absent attribute rather than written through. The previous version called
 * setAttribute unconditionally and produced `data-theme="system"`, which no
 * stylesheet matches — the palette fell through to the `:root` dark default, so
 * picking Auto always rendered dark no matter what the OS was set to. Leaving
 * the attribute off instead hands the choice to the
 * `:root:not([data-theme])` media query in globals.css, which also keeps it
 * live if the OS setting changes while the app is open.
 */
const themeScript = `
(function () {
  try {
    var saved = localStorage.getItem("sakura-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <meta name="referrer" content="no-referrer" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://res.cloudinary.com" />
        <link rel="dns-prefetch" href="https://e-cdns-images.dzcdn.net" />
        <link rel="icon" href="/icons/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="appRoot">
        <LogoLoader />
        <SWRegister />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
