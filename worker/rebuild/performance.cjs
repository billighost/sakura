/* eslint-disable @typescript-eslint/no-require-imports -- Shared Node/Workers telemetry. */
// Only fixed numeric aggregates are retained. Never pass request data, URLs,
// Telegram identities, authorization/session values, or raw errors here.
const STAGES = new Set(['storage_fence', 'socket_write', 'alarm_schedule', 'session_persist', 'connection_start']);
const COUNTERS = new Set(['packet_bytes', 'transfer_bytes', 'transfers_rejected']);
const MAXIMUMS = new Set(['peak_transfers']);
function createWorkerPerformance(enabled = false, clock = () => performance.now()) {
  const stages = {}, counters = {}, maximums = {};
  const add = (name, elapsed) => {
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    const prior = stages[name] || { count: 0, totalMs: 0, maxMs: 0 };
    stages[name] = { count: Math.min(Number.MAX_SAFE_INTEGER, prior.count + 1), totalMs: prior.totalMs + elapsed, maxMs: Math.max(prior.maxMs, elapsed) };
  };
  return {
    enabled,
    measure(name, work) {
      if (!enabled || !STAGES.has(name)) return work();
      const start = clock();
      try {
        const result = work();
        if (result && typeof result.then === 'function') return result.finally(() => add(name, clock() - start));
        add(name, clock() - start); return result;
      } catch (error) { add(name, clock() - start); throw error; }
    },
    count(name, value = 1) {
      if (enabled && COUNTERS.has(name) && Number.isSafeInteger(value) && value >= 0) counters[name] = Math.min(Number.MAX_SAFE_INTEGER, (counters[name] || 0) + value);
    },
    maximum(name, value) {
      if (enabled && MAXIMUMS.has(name) && Number.isSafeInteger(value) && value >= 0) maximums[name] = Math.max(maximums[name] || 0, value);
    },
    snapshot() {
      if (!enabled) return undefined;
      return { stages: Object.fromEntries(Object.entries(stages).map(([name, value]) => [name, { ...value }])), counters: { ...counters }, maximums: { ...maximums } };
    },
  };
}
module.exports = { createWorkerPerformance };
