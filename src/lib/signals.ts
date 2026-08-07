"use client";

/**
 * Client-side play-signal tracker.
 *
 * Watches actual audible playback (not wall-clock time — a paused tab isn't
 * listening) and batches finished plays to the server.
 *
 * Why batching: a listening session produces one event every few minutes, and
 * a request per event is pure overhead on a mobile connection. Why a queue in
 * localStorage: if the tab dies mid-session, the signals collected so far are
 * the most valuable ones we have, and losing them means losing the taste data
 * for that whole session.
 */

export type PendingSignal = {
  trackId: string;
  msPlayed: number;
  durationMs: number;
  completed: boolean;
  skipped: boolean;
  skipAtMs: number | null;
  context: string | null;
  contextId: string | null;
  autoplay: boolean;
  playedAt: string;
};

const STORAGE_KEY = "sakura-pending-signals";
const FLUSH_INTERVAL_MS = 60_000;
const MAX_QUEUE = 300;

/** Below this, a play is a misclick rather than a listen. */
const MIN_REPORTABLE_MS = 3_000;

class SignalTracker {
  private queue: PendingSignal[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /** Accumulated audible ms for the track currently loaded. */
  private accumulatedMs = 0;
  private lastTickAt: number | null = null;
  private currentTrackId: string | null = null;
  private currentDurationMs = 0;
  private currentContext: { context: string | null; contextId: string | null; autoplay: boolean } = {
    context: null,
    contextId: null,
    autoplay: false,
  };
  private startedAt: string = new Date().toISOString();

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    this.queue = this.loadQueue();

    this.flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);

    // A hidden tab may never come back. Flush what we have, using sendBeacon
    // so the request survives the page going away — a normal fetch here is
    // routinely cancelled during unload.
    const onHide = () => {
      if (document.visibilityState === "hidden") this.flush({ beacon: true });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => this.flush({ beacon: true }));
  }

  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.started = false;
  }

  /**
   * Switch to a new track. Closes out the previous one as a completed or
   * skipped play depending on how far it got.
   */
  beginTrack(
    trackId: string,
    durationMs: number,
    ctx?: { context?: string | null; contextId?: string | null; autoplay?: boolean }
  ) {
    if (this.currentTrackId && this.currentTrackId !== trackId) {
      this.endTrack();
    }
    if (this.currentTrackId === trackId) {
      // Same track re-armed (e.g. a re-render) — keep accumulating.
      return;
    }
    this.currentTrackId = trackId;
    this.currentDurationMs = durationMs;
    this.accumulatedMs = 0;
    this.lastTickAt = null;
    this.startedAt = new Date().toISOString();
    this.currentContext = {
      context: ctx?.context ?? null,
      contextId: ctx?.contextId ?? null,
      autoplay: ctx?.autoplay ?? false,
    };
  }

  /** Called on play / resume. */
  resume() {
    this.lastTickAt = Date.now();
  }

  /** Called on pause, seek-away, or stall. Banks the elapsed audible time. */
  pause() {
    if (this.lastTickAt != null) {
      this.accumulatedMs += Date.now() - this.lastTickAt;
      this.lastTickAt = null;
    }
  }

  /** Keep the duration fresh — it's often unknown until metadata loads. */
  setDuration(durationMs: number) {
    if (durationMs > 0) this.currentDurationMs = durationMs;
  }

  /**
   * Close out the current track and enqueue it.
   * @param opts.positionMs where playback was when it ended, for skip analysis
   * @param opts.natural    true when the track played through to its end event
   */
  endTrack(opts?: { positionMs?: number; natural?: boolean }) {
    if (!this.currentTrackId) return;
    this.pause();

    const msPlayed = Math.round(this.accumulatedMs);
    const durationMs = this.currentDurationMs;
    const trackId = this.currentTrackId;

    // Reset first so an early return can't leave stale state behind.
    this.currentTrackId = null;
    this.accumulatedMs = 0;
    this.lastTickAt = null;

    if (msPlayed < MIN_REPORTABLE_MS) return;

    const natural = opts?.natural ?? false;
    const ratio = durationMs > 0 ? msPlayed / durationMs : 0;
    const completed = natural || (durationMs > 0 && ratio >= 0.85);

    this.enqueue({
      trackId,
      msPlayed,
      durationMs,
      completed,
      skipped: !completed,
      skipAtMs: !completed && opts?.positionMs != null ? Math.round(opts.positionMs) : null,
      context: this.currentContext.context,
      contextId: this.currentContext.contextId,
      autoplay: this.currentContext.autoplay,
      playedAt: this.startedAt,
    });
  }

  private enqueue(signal: PendingSignal) {
    this.queue.push(signal);
    // Drop oldest first if the queue somehow grows unbounded (offline for a
    // long stretch). Recent signals are the more valuable ones.
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
    this.saveQueue();

    // Flush promptly once a handful have accumulated so taste updates feel
    // responsive rather than waiting out the full interval.
    if (this.queue.length >= 5) this.flush();
  }

  async flush(opts?: { beacon?: boolean }) {
    if (this.queue.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const batch = this.queue.slice();

    // Clear optimistically — on failure we merge the batch back in below.
    // Keeping it in place instead would double-count everything on a slow
    // network where a flush overlaps the next one.
    this.queue = [];
    this.saveQueue();

    const payload = JSON.stringify({ signals: batch });

    if (opts?.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      const ok = navigator.sendBeacon("/api/signals", new Blob([payload], { type: "application/json" }));
      if (!ok) this.restore(batch);
      return;
    }

    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
      if (!res.ok) this.restore(batch);
    } catch {
      this.restore(batch);
    }
  }

  private restore(batch: PendingSignal[]) {
    this.queue = [...batch, ...this.queue].slice(-MAX_QUEUE);
    this.saveQueue();
  }

  private loadQueue(): PendingSignal[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
    } catch {
      return [];
    }
  }

  private saveQueue() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // Storage full or blocked — signals are best-effort, never block playback.
    }
  }
}

/** Single shared instance — playback is a singleton, so tracking is too. */
export const signalTracker = new SignalTracker();
