"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import s from "./sticky-search.module.css";

/** Keep the original field mounted so selection, focus and mobile keyboards survive docking. */
export function StickySearch({ children, label = "Collection search", enabled = true }: {
 children: ReactNode;
 label?: string;
 enabled?: boolean;
}) {
 const marker = useRef<HTMLSpanElement>(null);
 const [docked, setDocked] = useState(false);

 useLayoutEffect(() => {
  if (!enabled || !marker.current) return;
  const element = marker.current;
  const root = element.closest("#music-main");
  let frame = 0;
  const update = () => {
   frame = 0;
   const top = root?.getBoundingClientRect().top ?? 0;
   setDocked(element.getBoundingClientRect().bottom <= top + 1);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = new IntersectionObserver(schedule, { root, threshold: [0, 1] });
  observer.observe(element);
  const resize = new ResizeObserver(schedule);
  if (root) resize.observe(root);
  (root ?? window).addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update();
  return () => {
   observer.disconnect(); resize.disconnect();
   if (frame) cancelAnimationFrame(frame);
   (root ?? window).removeEventListener("scroll", schedule);
   window.removeEventListener("resize", schedule);
  };
 }, [enabled]);

 if (!enabled) return <>{children}</>;
 return <><span ref={marker} className={s.marker} aria-hidden="true"/><div className={s.dock} role="region" aria-label={label} data-sticky-search data-docked={docked || undefined}>
  {children}
 </div></>;
}
