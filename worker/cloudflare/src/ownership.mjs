// A replacement fences old writes immediately, then lets any already-issued
// packet drain for 35 seconds before opening another Telegram main connection.
export const DRAIN_MS = 35000;
export class Ownership {
  constructor(storage, token, now = Date.now, metrics) { this.storage = storage; this.token = token; this.now = now; this.metrics = metrics; }
  async claim() {
    return this.storage.transaction(async tx => {
      const prior = await tx.get('ownership');
      const readyAt = prior ? Math.max(this.now(), Number(prior.lastWrite || 0) + DRAIN_MS) : this.now();
      await tx.put('ownership', { token: this.token, readyAt, lastWrite: prior?.lastWrite || 0 });
      return readyAt;
    });
  }
  async fence() {
    const work = () => this.storage.transaction(async tx => {
      const current = await tx.get('ownership');
      if (!current || current.token !== this.token) throw new Error('Telegram owner retired');
      if (this.now() < current.readyAt) throw new Error('Telegram owner draining');
      await tx.put('ownership', { ...current, lastWrite: this.now() });
    });
    await (this.metrics ? this.metrics.measure('storage_fence', work) : work());
  }
}
