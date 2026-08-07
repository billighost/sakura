"use client";

import { useEffect, useState } from "react";

/**
 * Registers the worker and handles the update handshake.
 *
 * The previous version fired `register()` and ignored the result, so a
 * deployed update sat in the "waiting" state until every tab was closed —
 * which for an installed PWA can be days. Now an update is detected and the
 * user is offered a one-tap reload.
 *
 * Registration is deferred until after load so it never competes with the
 * first paint for bandwidth.
 */
export function SWRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;

    let registration: ServiceWorkerRegistration | undefined;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });

        // An update already downloaded and waiting from a previous session.
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration!.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            // `controller` being set means this is an update, not a first install.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
            }
          });
        });
      } catch (err) {
        console.warn("[SW] Registration failed:", err);
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    // The new worker taking control is the signal that a reload is safe.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(var(--bottom-chrome, 7rem) + 0.75rem)",
        zIndex: 420,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.625rem 0.75rem 0.625rem 1rem",
        borderRadius: "999px",
        background: "var(--sakura-glass-strong)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--sakura-glass-border)",
        boxShadow: "0 8px 30px -8px var(--sakura-shadow)",
        color: "var(--sakura-text)",
        fontSize: "0.8125rem",
        maxWidth: "calc(100vw - 2rem)",
      }}
    >
      <span>A new version is ready</span>
      <button
        onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}
        style={{
          border: "none",
          borderRadius: "999px",
          padding: "0.375rem 0.875rem",
          minHeight: "unset",
          minWidth: "unset",
          background: "var(--sakura-accent-gradient)",
          color: "#fff",
          fontSize: "0.8125rem",
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Update
      </button>
    </div>
  );
}

/** Purge worker-held caches. Call on sign-out. */
export function clearServiceWorkerCaches() {
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
}
