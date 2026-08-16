"use client";

import { useEffect, useState } from "react";
import { extractDominantColor } from "@/lib/color";

/**
 * Wires artwork colour into `--hero-tint`.
 *
 * The gradient purge rewrote every `.heroGradient` in the app to ramp from
 * `var(--hero-tint, transparent)`, which left the detail pages ramping from
 * *nothing* — a correct-by-construction flat scrim that also threw away the one
 * piece of colour the design language does allow over artwork. This is the
 * missing half.
 *
 * What it deliberately does not do is set `--bg`. The album page used to write
 * the extracted colour into `--bg` on the hero element, which is the global
 * background token: every descendant reading `var(--bg)` — including the scrim's
 * own end stop — picked up the accent, so the "ramp to the page colour" resolved
 * to accent→accent and the hero rendered as a flat slab of whatever colour the
 * cover happened to average to. A dedicated variable can't collide like that.
 */

/**
 * `null` until extraction resolves, and `null` forever if it can't — a cover
 * that's a scan of white paper legitimately has no usable accent, and the
 * fallback in `var(--hero-tint, transparent)` is the right answer there.
 */
export function useArtworkTint(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ src: string; colour: string | null } | null>(null);

  useEffect(() => {
    if (!src) return;

    let active = true;
    // extractDominantColor caches per URL and coalesces in-flight requests, so
    // a re-render or a second component asking for the same cover is free.
    extractDominantColor(src).then((colour) => {
      if (active) setResolved({ src, colour });
    });

    return () => {
      active = false;
    };
  }, [src]);

  /*
   * The answer is stored *with* the URL it came from and matched during render,
   * rather than cleared by the effect when `src` changes. Two reasons: clearing
   * from an effect is a cascading render, and more importantly a tint that
   * belongs to the previous cover would paint the new one for a frame — on a
   * track page opened from another track page, that's a visible wrong-colour
   * flash before the right colour arrives.
   */
  return src && resolved?.src === src ? resolved.colour : null;
}

/**
 * Client wrapper for server-rendered pages.
 *
 * The track page is a server component, so it can't call the hook itself.
 * Rather than converting the whole page to a client component for one CSS
 * variable, it wraps its hero in this — the markup inside stays server-rendered
 * and only the tint arrives on the client.
 */
export function ArtworkTint({
  src,
  className,
  children,
}: {
  src: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const tint = useArtworkTint(src);

  return (
    <div
      className={className}
      style={tint ? ({ "--hero-tint": tint } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
