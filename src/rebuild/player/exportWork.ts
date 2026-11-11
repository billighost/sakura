/** Give input, playback and painting a turn between expensive export batches. */
export function checkExportCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
}

export async function yieldExport(signal?: AbortSignal) {
  checkExportCanceled(signal);
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  checkExportCanceled(signal);
}

/** Avoid a task per SVG leaf or frame while keeping a bounded input delay. */
export function exportCheckpoint(signal?: AbortSignal, budgetMs = 8) {
  let deadline = performance.now() + budgetMs;
  return async () => {
    checkExportCanceled(signal);
    if (performance.now() < deadline) return;
    await yieldExport(signal);
    deadline = performance.now() + budgetMs;
  };
}
