"use client";

import { getDeviceId } from "./offline-db";

/**
 * Client half of cross-device continuity.
 *
 * Design constraints that shaped this:
 *
 *  - **Writes must be cheap.** Position changes several times a second. Sending
 *    that to the server would be absurd, so position is pushed on a slow
 *    heartbeat plus the moments that actually matter (pause, track change, tab
 *    hidden, unload).
 *  - **Unload must not lose the last position.** A normal `fetch` is cancelled
 *    when the page goes away; `sendBeacon` is the only thing guaranteed to
 *    survive it.
 *  - **Never rewind the listener.** Remote state is only adopted when it's
 *    meaningfully newer than what this device has, and never while something is
 *    already playing here.
 */

export interface RemoteTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

export interface PlaybackSnapshot {
  trackId: string | null;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  queue: RemoteTrack[];
  upNext: RemoteTrack[];
  queueIndex: number;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  context: string | null;
  contextId: string | null;
}

export interface RemoteState extends PlaybackSnapshot {
  deviceId: string | null;
  updatedAt: string;
}

const ENDPOINT = "/api/playback-state";

/** Heartbeat while playing. Long enough to be negligible at 10k users. */
const HEARTBEAT_MS = 20_000;

/**
 * How far ahead remote state must be before it's worth interrupting for.
 * Below this it's almost certainly this device's own echo, or a difference no
 * one would notice.
 */
const ADOPT_THRESHOLD_MS = 10_000;

let lastPushedAt = 0;
let lastPayload = "";

function serialise(snapshot: PlaybackSnapshot) {
  return JSON.stringify({
    ...snapshot,
    // Only the fields the server keeps — sending audioUrl would leak signed
    // URLs into a row other devices read.
    queue: snapshot.queue.map(slimTrack),
    upNext: snapshot.upNext.map(slimTrack),
    deviceId: getDeviceId(),
  });
}

function slimTrack(t: RemoteTrack): RemoteTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    duration: t.duration,
  };
}

/**
 * Push state to the server.
 *
 * `force` bypasses both the throttle and the "nothing changed" check — used for
 * the events that must not be dropped (pause, track change, unload).
 */
export async function pushPlaybackState(
  snapshot: PlaybackSnapshot,
  { force = false, beacon = false }: { force?: boolean; beacon?: boolean } = {}
): Promise<void> {
  if (typeof navigator === "undefined") return;

  const body = serialise(snapshot);

  if (!force) {
    if (Date.now() - lastPushedAt < HEARTBEAT_MS) return;
    // Position always differs, so compare everything else to decide whether
    // this is a real change or just the clock moving.
    if (body === lastPayload) return;
  }

  lastPushedAt = Date.now();
  lastPayload = body;

  // Unload path: fetch() is cancelled when the document goes away.
  if (beacon && "sendBeacon" in navigator) {
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    } catch {
      // fall through to fetch
    }
  }

  try {
    await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Continuity is a convenience; a failed sync must never surface as an error.
  }
}

/** Read the server's copy. Returns null when there's nothing to resume. */
export async function fetchPlaybackState(): Promise<RemoteState | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  try {
    const res = await fetch(ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.state as RemoteState) ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide whether remote state should replace what this device has.
 *
 * Returns false when:
 *   - there's nothing to adopt,
 *   - this device wrote it (its own echo),
 *   - audio is already playing here — interrupting someone mid-song to sync a
 *     position from another device is never the right call,
 *   - or the difference is too small to be worth a jump.
 */
export function shouldAdoptRemote(
  remote: RemoteState | null,
  local: { trackId: string | null; positionMs: number; isPlaying: boolean }
): boolean {
  if (!remote || !remote.trackId) return false;
  if (remote.deviceId && remote.deviceId === getDeviceId()) return false;
  if (local.isPlaying) return false;

  // Different track entirely — the other device moved on, follow it.
  if (remote.trackId !== local.trackId) return true;

  // Same track: only jump if the remote position is meaningfully further along.
  return remote.positionMs - local.positionMs > ADOPT_THRESHOLD_MS;
}

export { HEARTBEAT_MS };
