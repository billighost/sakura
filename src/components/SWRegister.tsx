"use client";

import { useEffect, useState } from "react";
import styles from "./SWRegister.module.css";

/**
 * Registers the worker and handles the update handshake.
 *
 * ── The first-visit reload ─────────────────────────────────────────────────
 *
 * `controllerchange` fires in two quite different situations and this used to
 * treat them as one:
 *
 *   1. An update took over from a previous worker. Reloading is right — the
 *      page is running code the new worker no longer serves.
 *   2. The *first* worker claimed an until-then uncontrolled page, which is
 *      what `clients.claim()` in the activate handler does on a first visit.
 *
 * Case 2 meant every brand-new visitor got a full page reload a second or two
 * after landing, for no reason and with no warning. Capturing whether a
 * controller existed *before* registering separates the two: no prior
 * controller means this is a first install and there is nothing to reload for.
 *
 * ── Checking for updates at all ────────────────────────────────────────────
 *
 * The browser re-fetches sw.js on navigation, which a single-page app almost
 * never performs — an installed PWA can stay open for days and never once look
 * for a new version. So this also checks explicitly when the app comes back to
 * the foreground, throttled so tabbing in and out doesn't hammer the origin.
 *
 * Registration itself is deferred until after load so it never competes with
 * the first paint for bandwidth.
 */

/** Minimum gap between explicit update checks. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function SWRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    /*
     * In development, actively tear down any worker that is still controlling
     * this origin — don't just decline to register a new one.
     *
     * Returning early was not enough. A worker installed by `next build && next
     * start`, a deployed build opened on the same host, or simply an earlier
     * session before this guard existed, stays registered and keeps controlling
     * `localhost` indefinitely. It then answers `/_next/static/**` from
     * `cacheFirst`, which is correct in production (those filenames are content
     * hashed) and actively harmful under `next dev`, where Turbopack reuses chunk
     * URLs across recompiles. The router fetches the route it is navigating to,
     * receives a stale module for it out of the cache, and the navigation lands
     * on code that no longer matches the page — the URL changes, the payload
     * arrives, and nothing renders.
     *
     * Unregistering alone leaves the caches behind, so drop those too.
     */
    if (process.env.NODE_ENV === "development") {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (registrations.length === 0) return;

        await Promise.all(registrations.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith("sakura-")).map((k) => caches.delete(k))
        );

        console.warn(
          "[SW] Unregistered a leftover service worker and cleared its caches. " +
            "Reload once to finish detaching it from this page."
        );
      })();
      return;
    }

    /*
     * Read before registering. Once `register()` resolves and the worker
     * activates, this is no longer answerable — which is the whole reason the
     * spurious first-visit reload was so easy to miss.
     */
    const hadController = Boolean(navigator.serviceWorker.controller);

    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();

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

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      registration?.update().catch(() => {
        // Offline, or the origin is unreachable. Nothing to do — the next
        // foreground pass tries again.
      });
    };
    document.addEventListener("visibilitychange", checkForUpdate);

    // The new worker taking control is the signal that a reload is safe — but
    // only when it displaced an older one. See the header.
    let reloading = false;
    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div className={styles.pill} role="status">
      <span className={styles.label}>A new version is ready</span>
      <button
        type="button"
        className={`${styles.button} pressable`}
        onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}
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
