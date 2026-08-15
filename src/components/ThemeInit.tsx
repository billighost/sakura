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
   * Next owns the theme-color metas from `viewport.themeColor`, and re-inserts
   * them when route metadata is applied. An explicit theme needs a single
   * unscoped tag to outrank them, so it has to be re-asserted after a
   * navigation rather than only at boot.
   */
  useEffect(() => {
    syncThemeColor(getTheme());
  }, [pathname]);

  return null;
}
