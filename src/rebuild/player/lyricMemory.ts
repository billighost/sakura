/** Cache generations belong to retained values or live readers/writers. A new
 * generation object prevents an evicted key from accepting an old completion. */
interface Generation { owners: number; write: number; publication: number }
export interface LyricGeneration { readonly key: string; readonly generation: object; readonly write: number; readonly publication: number }

export class LyricMemory<T extends { key: string }> {
  private readonly values = new Map<string, { value: T; bytes: number }>();
  private readonly generations = new Map<string, Generation>();
  private bytes = 0;
  constructor(private readonly maximumEntries = 128, private readonly maximumBytes = 8 * 1024 * 1024) {}

  acquire(key: string) {
    let generation = this.generations.get(key);
    if (!generation) { generation = { owners: 0, write: 0, publication: 0 }; this.generations.set(key, generation); }
    generation.owners++;
    let released = false;
    const snapshot = (): LyricGeneration => ({ key, generation, write: generation.write, publication: generation.publication });
    return {
      snapshot,
      write: () => { generation.write++; return snapshot(); },
      publish: () => { generation.publication++; generation.write++; return snapshot(); },
      release: () => {
        if (released) return;
        released = true; generation.owners--;
        this.prune(); this.retire(key, generation);
      },
    };
  }
  writeCurrent(snapshot: LyricGeneration) {
    const current = this.generations.get(snapshot.key);
    return current === snapshot.generation && current.write === snapshot.write;
  }
  publicationCurrent(snapshot: LyricGeneration) {
    const current = this.generations.get(snapshot.key);
    return current === snapshot.generation && current.publication === snapshot.publication;
  }
  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return;
    this.values.delete(key); this.values.set(key, entry);
    return entry.value;
  }
  set(value: T) {
    this.delete(value.key);
    const bytes = JSON.stringify(value).length * 2;
    if (this.maximumEntries <= 0 || bytes > this.maximumBytes) return;
    // Callers inserting values hold a generation lease until publication and
    // persistence finish. Standalone insertion is also safe for pure fixtures.
    if (!this.generations.has(value.key)) this.generations.set(value.key, { owners: 0, write: 0, publication: 0 });
    this.values.set(value.key, { value, bytes }); this.bytes += bytes;
    this.prune();
  }
  delete(key: string) {
    const old = this.values.get(key);
    if (old) { this.bytes -= old.bytes; this.values.delete(key); }
    const generation = this.generations.get(key);
    if (generation) this.retire(key, generation);
  }
  private retire(key: string, generation: Generation) {
    if (generation.owners === 0 && !this.values.has(key) && this.generations.get(key) === generation) this.generations.delete(key);
  }
  private prune() {
    if (this.values.size <= this.maximumEntries && this.bytes <= this.maximumBytes) return;
    for (const [key, entry] of this.values) {
      if ((this.generations.get(key)?.owners || 0) > 0) continue;
      this.values.delete(key); this.bytes -= entry.bytes;
      const generation = this.generations.get(key);
      if (generation) this.retire(key, generation);
      if (this.values.size <= this.maximumEntries && this.bytes <= this.maximumBytes) break;
    }
  }
  stats() { return { entries: this.values.size, bytes: this.bytes, generations: this.generations.size }; }
}
