"use client";

import { useEffect, type RefObject } from "react";

/** Suspend decoration outside the scroll viewport without rendering on scroll. */
export function useVisibleMotion(rootRef: RefObject<HTMLElement | null>, regionVersion: unknown = 0) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const regions = Array.from(root.querySelectorAll<HTMLElement>("[data-motion-region]"));
    const visible = new Map<Element, boolean>();
    const update = (region: HTMLElement) => {
      const active = !document.hidden && visible.get(region) !== false;
      const value = String(active);
      if (region.dataset.motionActive !== value) region.dataset.motionActive = value;
    };
    const visibilityChanged = () => regions.forEach(update);
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        visible.set(entry.target, entry.isIntersecting);
        update(entry.target as HTMLElement);
      }
    }, { root: root.closest("#music-main"), rootMargin: "96px 0px" }) : null;
    for (const region of regions) {
      update(region);
      observer?.observe(region);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [rootRef, regionVersion]);
}
