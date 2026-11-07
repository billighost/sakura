import type { QueueEntry } from "./types";

/** History/current stay fixed; intentional choices always precede the context queue. */
export function upcomingQueue(entries: readonly QueueEntry[], currentId: string | null) {
  const current = entries.findIndex(entry => entry.entryId === currentId);
  return entries.slice(current + 1);
}

export function appendManual(entries: readonly QueueEntry[], currentId: string | null, entry: QueueEntry): QueueEntry[] {
  const current = entries.findIndex(item => item.entryId === currentId);
  const history = entries.slice(0, current + 1);
  const upcoming = entries.slice(current + 1);
  return [...history, ...upcoming.filter(item => item.priority === "manual"), { ...entry, priority: "manual" }, ...upcoming.filter(item => item.priority !== "manual")];
}

export function moveUpcoming(entries: readonly QueueEntry[], currentId: string | null, entryId: string, delta: number): QueueEntry[] {
  const current = entries.findIndex(entry => entry.entryId === currentId);
  const index = entries.findIndex(entry => entry.entryId === entryId);
  const target = index + delta;
  if (index <= current || target <= current || target >= entries.length || (entries[index].priority === "manual") !== (entries[target].priority === "manual")) return entries as QueueEntry[];
  const reordered = [...entries];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}

export function reorderUpcoming(entries: readonly QueueEntry[], currentId: string | null, entryId: string, beforeId: string | null): QueueEntry[] {
  const upcoming = upcomingQueue(entries, currentId);
  const entry = upcoming.find(item => item.entryId === entryId);
  if (!entry || entryId === beforeId) return entries as QueueEntry[];
  const manual = entry.priority === "manual";
  const group = upcoming.filter(item => (item.priority === "manual") === manual && item.entryId !== entryId);
  const target = beforeId === null ? group.length : group.findIndex(item => item.entryId === beforeId);
  if (target < 0) return entries as QueueEntry[];
  group.splice(target, 0, entry);
  const history = entries.slice(0, entries.findIndex(item => item.entryId === currentId) + 1);
  return [...history, ...(manual ? group : upcoming.filter(item => item.priority === "manual")), ...(manual ? upcoming.filter(item => item.priority !== "manual") : group)];
}

export function clearUpcoming(entries: readonly QueueEntry[], currentId: string | null): QueueEntry[] {
  return entries.slice(0, entries.findIndex(entry => entry.entryId === currentId) + 1);
}

export function nextUpcoming(entries: readonly QueueEntry[], currentId: string | null, shuffle: boolean, random = Math.random): QueueEntry | undefined {
  const upcoming = upcomingQueue(entries, currentId);
  const manual = upcoming.find(entry => entry.priority === "manual");
  if (manual) return manual;
  if (!upcoming.length) return undefined;
  return upcoming[shuffle ? Math.min(upcoming.length - 1, Math.floor(random() * upcoming.length)) : 0];
}
