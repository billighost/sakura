"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getTheme, paintTheme, subscribeTheme, syncThemeColor } from "@/lib/theme";

/**
 * Keeps the live document in step with the stored theme.
 *
 * The blocking script in the root layout paints the theme before first paint,
 * which is the part that has to happen synchronously. Everything after that
 * needs a mounted listener, and until now there wasn't one — so:
 *
 *   - a theme change in another tab (or in another window of the installed PWA)
 *     was invisible until reload;
 *   - the boot script sets `data-theme` but never touches the theme-color
 *     metas, so an explicit light theme on a dark-mode phone booted with a dark
 *     status bar above a light page;
 *   - `globals.css` documents a `.theme-transition` class applied by
 *     "`ThemeInit`", a component that did not exist. This is it.
 *
 * Renders nothing. Mounted once, at the root, above the app shell.
 */
export function ThemeInit() {
  const pathname = usePathname();

  useEffect(() => {
    // The boot script only wrote the attribute. Re-applying through the shared
    // path also lands the chrome colour, which it can't do (no <head> access
    // ordering guarantees for metadata that Next injects afterwards).
    paintTheme(getTheme());
    return subscribeTheme(() => {});
  }, []);

  /*
   * Next re-applies `viewport.themeColor` when route metadata lands, and can
   * insert those tags ahead of the override `syncThemeColor` owns — which would
   * hand the first-match back to the media-scoped pair. So the override is
   * re-asserted per navigation.
   *
   * This deliberately does not touch Next's tags. React created them, and
   * detaching them here is what used to abort React's commit phase on every
   * navigation and leave the page dead. See the header of `lib/theme.ts`.
   */
  useEffect(() => {
    syncThemeColor(getTheme());
  }, [pathname]);

  return null;
}
