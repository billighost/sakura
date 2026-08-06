import { useEffect, useRef, useState } from "react";

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 70 }: PullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(false);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handlePointerDown(e: PointerEvent) {
      if (refreshing) return;
      
      // Target the content viewport container (ensure only active at scrollTop === 0)
      const container = (e.currentTarget as HTMLElement) || document.documentElement;
      if (container.scrollTop !== 0) return;

      // Only track touch/mouse primary button drags
      if (e.button !== undefined && e.button !== 0) return;

      startYRef.current = e.clientY;
      currentYRef.current = e.clientY;
      setActive(true);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!active || refreshing) return;

      currentYRef.current = e.clientY;
      const dy = e.clientY - startYRef.current;

      if (dy > 0) {
        // Apply rubber banding damping past threshold
        const distance = dy > threshold ? threshold + (dy - threshold) * 0.25 : dy;
        setPullDistance(distance);
        if (e.cancelable) e.preventDefault();
      } else {
        setPullDistance(0);
      }
    }

    function handlePointerUp() {
      if (!active || refreshing) return;
      setActive(false);

      const dy = currentYRef.current - startYRef.current;
      if (dy >= threshold) {
        setRefreshing(true);
        import("@/lib/haptics").then((h) => h.vibrate(12));
        onRefresh().finally(() => {
          setRefreshing(false);
          setPullDistance(0);
        });
      } else {
        setPullDistance(0);
      }
    }

    // Bind to the scrollable container. Since this page has scroll container, 
    // it will be mounted dynamically.
    return () => {
      // Cleanups
    };
  }, [active, refreshing, onRefresh, threshold]);

  return {
    pullDistance,
    refreshing,
    active,
    setActive,
    startYRef,
    currentYRef,
    setPullDistance,
    setRefreshing,
  };
}
