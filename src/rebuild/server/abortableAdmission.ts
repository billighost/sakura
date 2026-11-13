/** Bound unfinished work and its waiting owners. A running operation retains
 * its slot until cleanup settles, even when a provider ignores cancellation. */
export class AbortableAdmission {
  private active = 0;
  private readonly waiting: Array<{ signal: AbortSignal; grant: () => void; abort: () => void }> = [];
  constructor(private readonly concurrency: number, private readonly capacity: number) {}
  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.capacity) throw new Error("Background reading work is busy. Try again shortly.");
      await new Promise<void>((resolve, reject) => {
        const entry = {
          signal,
          grant: () => { signal.removeEventListener("abort", entry.abort); this.active++; resolve(); },
          abort: () => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); reject(signal.reason); },
        };
        this.waiting.push(entry); signal.addEventListener("abort", entry.abort, { once: true });
        if (signal.aborted) entry.abort();
      });
    } else this.active++;
    try { signal.throwIfAborted(); return await operation(); }
    finally {
      this.active--;
      while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!.grant();
    }
  }
  stats() { return { active: this.active, waiting: this.waiting.length }; }
}
