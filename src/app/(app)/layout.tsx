import AppShellRoot from "./AppShellRoot";

/**
 * Server layout for the signed-in app, wrapping the client shell.
 *
 * ── Why this file is a server component and the shell is not ────────────────
 *
 * The whole app shell — player, nav, share, tab bar, mini player — is client
 * code, and it used to live here with a `"use client"` at the top. That worked
 * until Cache Components arrived, because `instant` is a route segment config
 * and Next.js only reads it from a **server** module: exported from a
 * `"use client"` file it fails the build with "can only be used when the segment
 * is a Server Component module". So the shell moved to `AppShellRoot.tsx` and
 * this file became the thin server wrapper that can carry the config.
 *
 * ── Why the whole group opts out of instant validation ──────────────────────
 *
 * `AppNavProvider` reads `usePathname()` (for scroll restoration and for
 * resolving the view transition on route commit) and `PlayerContext` reads it
 * too. Both sit above every page in the group. On a static route the path is
 * known at build time and prerenders fine; on a `[param]` route — album, artist,
 * playlist, mix, browse, track — it's runtime data, so prerendering stops at the
 * provider and validation fails with `CLIENT_HOOK_DYNAMIC`.
 *
 * The two documented fixes are to wrap the offending component in `<Suspense>`
 * or to opt the segment out. Suspense is the wrong tool here: these providers
 * sit above the entire UI, so suspending them would push the tab bar, the mini
 * player and the page frame behind a boundary and leave nothing to prerender —
 * paying the cost of a boundary to gain an empty shell.
 *
 * Declaring it once at the group level rather than per page is deliberate: the
 * cause is shared by every route underneath, so six copies of the same opt-out
 * would just be six places to forget. Note this does *not* force these routes
 * dynamic — a genuinely prerenderable route still ships its static shell, and
 * `partialPrefetching` still prefetches one App Shell per route. What's given up
 * is the dev-time validation nag, not the prerendering.
 *
 * To undo it, the providers have to stop reading URL state above the page — move
 * `usePathname()` down into only the components that need it (TabBar,
 * SmoothScroll), each behind its own boundary.
 */
export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShellRoot>{children}</AppShellRoot>;
}
