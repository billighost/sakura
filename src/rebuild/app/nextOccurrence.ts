import type { QueueEntry } from "./types";
import { nextUpcoming, nextUserRepeat } from "./listeningQueue";

export interface NextOccurrenceOptions {
  queue: readonly QueueEntry[];
  currentEntryId: string | null;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  anchorEntryId?: string | null;
  eligible?: (entry: QueueEntry) => boolean;
}

/** Preparation and transport share one random choice until listening changes.
 * Metadata updates return the live occurrence without rerolling shuffle. */
export class NextOccurrencePlanner {
  private key = "";
  private entryId: string | undefined;

  reserve(options: NextOccurrenceOptions, random = Math.random): QueueEntry | undefined {
    const { queue, currentEntryId, shuffle, repeat } = options;
    const eligible = options.eligible ?? (() => true);
    const anchor = options.anchorEntryId && queue.some(entry => entry.entryId === options.anchorEntryId)
      ? options.anchorEntryId : currentEntryId;
    const key = JSON.stringify([currentEntryId, shuffle, repeat, anchor,
      queue.map(entry => [entry.entryId, entry.priority, eligible(entry)])]);
    if (key !== this.key) {
      this.key = key;
      // Retain the existing selection rules: intentional picks precede
      // contextual shuffle; repeat-all follows its anchored manual cycle.
      this.entryId = (repeat === "all"
        ? nextUserRepeat(queue, currentEntryId, anchor, eligible)
        : nextUpcoming(queue, currentEntryId, shuffle, random))?.entryId;
    }
    return this.entryId ? queue.find(entry => entry.entryId === this.entryId) : undefined;
  }

  clear() { this.key = ""; this.entryId = undefined; }
}

/** Empty background continuation must not repeat on every media state event.
 * Explicit requests/reconnection can clear the gate without changing sync cadence. */
export class AutoplayRetryGate {
  private entries = new Map<string, { failures: number; nextAt: number }>();
  constructor(private readonly now = () => performance.now()) {}
  ready(key: string) { return (this.entries.get(key)?.nextAt ?? 0) <= this.now(); }
  empty(key: string) {
    const failures = Math.min(4, (this.entries.get(key)?.failures ?? 0) + 1);
    this.entries.delete(key);
    this.entries.set(key, { failures, nextAt: this.now() + Math.min(30_000, 2_000 * 2 ** (failures - 1)) });
    while (this.entries.size > 16) this.entries.delete(this.entries.keys().next().value!);
  }
  success(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
