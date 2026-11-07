export interface QueueEntry {
  /** A new ID per insertion, even when the recording is already in the queue. */
  entryId: string;
  recordingId: string;
  durationMs?: number;
  source?: { kind: "mix" | "album" | "playlist" | "search" | "library" | "radio" | "direct"; id?: string };
}
export type PlaybackStatus = "idle" | "resolving" | "ready" | "playing" | "paused" | "error";
export interface QueueState {
  entries: readonly QueueEntry[];
  currentEntryId: string | null;
  status: PlaybackStatus;
  positionMs: number;
  repeat: "off" | "one" | "all";
  /** Every selection invalidates a previous asynchronous resolver or audio event. */
  requestVersion: number;
  error?: string;
}
export const EMPTY_QUEUE: QueueState = { entries: [], currentEntryId: null, status: "idle", positionMs: 0, repeat: "off", requestVersion: 0 };
export type QueueEvent =
  | { type: "replace"; entries: readonly QueueEntry[]; startEntryId?: string }
  | { type: "append" | "play-next"; entries: readonly QueueEntry[] }
  | { type: "select" | "remove"; entryId: string }
  | { type: "move"; entryId: string; beforeEntryId: string | null }
  | { type: "next" | "previous" | "ended" }
  | { type: "resolved" | "playing" | "paused" | "failed"; requestVersion: number; error?: string }
  | { type: "seek"; positionMs: number }
  | { type: "repeat"; mode: QueueState["repeat"] };

function select(state: QueueState, currentEntryId: string | null): QueueState {
  return { ...state, currentEntryId, status: currentEntryId ? "resolving" : "idle", positionMs: 0, requestVersion: state.requestVersion + 1, error: undefined };
}

function assertEntries(entries: readonly QueueEntry[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.entryId || !entry.recordingId || ids.has(entry.entryId)) throw new Error("Every queue occurrence requires a unique entry ID and canonical recording ID");
    if (entry.durationMs !== undefined && (!Number.isFinite(entry.durationMs) || entry.durationMs <= 0)) throw new Error("Queue duration must be positive");
    ids.add(entry.entryId);
  }
}

/** Pure transport logic: adapters resolve audio and send real media events afterwards. */
export function reduceQueue(state: QueueState, event: QueueEvent): QueueState {
  if (event.type === "replace") {
    assertEntries(event.entries);
    if (event.startEntryId && !event.entries.some((entry) => entry.entryId === event.startEntryId)) throw new Error("Start occurrence is absent from the queue");
    return select({ ...state, entries: event.entries.map((entry) => ({ ...entry })) }, event.startEntryId ?? event.entries[0]?.entryId ?? null);
  }
  if (event.type === "append" || event.type === "play-next") {
    assertEntries([...state.entries, ...event.entries]);
    const at = event.type === "append" ? state.entries.length : Math.max(0, state.entries.findIndex((entry) => entry.entryId === state.currentEntryId) + 1);
    const entries = [...state.entries.slice(0, at), ...event.entries.map((entry) => ({ ...entry })), ...state.entries.slice(at)];
    return { ...state, entries };
  }
  if (event.type === "select") {
    if (!state.entries.some((entry) => entry.entryId === event.entryId)) return state;
    return select(state, event.entryId);
  }
  if (event.type === "remove") {
    const at = state.entries.findIndex((entry) => entry.entryId === event.entryId);
    if (at < 0) return state;
    const entries = state.entries.filter((entry) => entry.entryId !== event.entryId);
    const next = { ...state, entries };
    return state.currentEntryId === event.entryId ? select(next, entries[at]?.entryId ?? entries[at - 1]?.entryId ?? null) : next;
  }
  if (event.type === "move") {
    const entry = state.entries.find((item) => item.entryId === event.entryId);
    if (!entry || event.entryId === event.beforeEntryId) return state;
    const entries = state.entries.filter((item) => item.entryId !== event.entryId);
    const at = event.beforeEntryId === null ? entries.length : entries.findIndex((item) => item.entryId === event.beforeEntryId);
    if (at < 0) return state;
    return { ...state, entries: [...entries.slice(0, at), entry, ...entries.slice(at)] };
  }
  if (event.type === "repeat") return { ...state, repeat: event.mode };
  if (event.type === "seek") {
    if (!state.currentEntryId || !Number.isFinite(event.positionMs)) return state;
    const duration = state.entries.find((entry) => entry.entryId === state.currentEntryId)?.durationMs ?? Infinity;
    return { ...state, positionMs: Math.max(0, Math.min(duration, event.positionMs)) };
  }
  if (event.type === "next" || event.type === "previous" || event.type === "ended") {
    const at = state.entries.findIndex((entry) => entry.entryId === state.currentEntryId);
    if (at < 0) return state;
    if (event.type === "ended" && state.repeat === "one") return select(state, state.currentEntryId);
    if (event.type === "previous" && state.positionMs > 3000) return { ...state, positionMs: 0 };
    const to = at + (event.type === "previous" ? -1 : 1);
    if (to >= 0 && to < state.entries.length) return select(state, state.entries[to].entryId);
    if (state.repeat === "all") return select(state, state.entries[to < 0 ? state.entries.length - 1 : 0]?.entryId ?? null);
    return event.type === "previous" ? { ...state, positionMs: 0 } : { ...state, status: "paused", positionMs: state.entries[at].durationMs ?? state.positionMs, requestVersion: state.requestVersion + 1 };
  }
  if (!("requestVersion" in event) || event.requestVersion !== state.requestVersion || !state.currentEntryId) return state;
  if (event.type === "resolved" && state.status === "resolving") return { ...state, status: "ready" };
  if (event.type === "playing" && (state.status === "ready" || state.status === "paused")) return { ...state, status: "playing" };
  if (event.type === "paused" && (state.status === "playing" || state.status === "ready")) return { ...state, status: "paused" };
  if (event.type === "failed") return { ...state, status: "error", error: event.error ?? "Audio unavailable" };
  return state;
}

/** Only one queue occurrence can show the playing indicator. */
export function isQueueEntryPlaying(state: QueueState, entryId: string): boolean {
  return state.status === "playing" && state.currentEntryId === entryId;
}
