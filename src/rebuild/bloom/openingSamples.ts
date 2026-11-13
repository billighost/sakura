export interface OpeningSamples {
  version: 1;
  seed: number;
  sampleRate: number;
  impulse: [Float32Array, Float32Array];
  noise: Float32Array;
}

/** Self-contained so the exact same arithmetic runs in a network-free worker.
 * Chunk boundaries only yield control; they never reset the filter history. */
export function* openingSampleBlocks(seed: number, sampleRate: number): Generator<void, OpeningSamples, void> {
  if (!Number.isFinite(seed) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("Unsupported opening sample configuration");
  const length = Math.floor(sampleRate * 2.5);
  const impulse: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse[channel];
    let previous = 0;
    for (let index = 0; index < data.length; index++) {
      const value = Math.sin(((seed + channel * 19) % 100000 + (index + 1) * 77.71) * 12.9898) * 43758.5453;
      previous = previous * .32 + ((value - Math.floor(value)) * 2 - 1) * .68;
      data[index] = previous * Math.pow(1 - index / data.length, 2.5) * .45;
      if (index % 2048 === 2047) yield;
    }
  }
  const noise = new Float32Array(sampleRate * 2);
  for (let index = 0; index < noise.length; index++) {
    const value = Math.sin((seed % 100000 + (index + 997) * 77.71) * 12.9898) * 43758.5453;
    noise[index] = ((value - Math.floor(value)) * 2 - 1) * .22;
    if (index % 2048 === 2047) yield;
  }
  return {version: 1, seed, sampleRate, impulse, noise};
}

export function generateOpeningSamples(seed: number, sampleRate: number): OpeningSamples {
  const blocks = openingSampleBlocks(seed, sampleRate);
  let result = blocks.next();
  while (!result.done) result = blocks.next();
  return result.value;
}

export function openingSampleWorkerSource() {
  return `const blocks = (${openingSampleBlocks.toString()});
self.onmessage = ({data}) => {
 try {
  const iterator = blocks(data.seed, data.sampleRate);
  let result = iterator.next();
  while (!result.done) result = iterator.next();
  const samples = result.value;
  self.postMessage(samples, [...samples.impulse.map(channel => channel.buffer), samples.noise.buffer]);
 } catch { self.postMessage({error: "Opening samples unavailable"}); }
};`;
}

async function yieldSamples(signal: AbortSignal) {
  signal.throwIfAborted();
  const scheduler = (globalThis as unknown as {scheduler?: {postTask?: (callback: () => void, options: {priority: "background"; signal: AbortSignal}) => Promise<void>}}).scheduler;
  if (scheduler?.postTask) await scheduler.postTask(() => {}, {priority: "background", signal});
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

/** Cooperative fallback for blocked/missing workers. No synchronous full-song
 * generation is allowed on the opening's input task. */
export async function generateOpeningSamplesYielded(seed: number, sampleRate: number, signal: AbortSignal): Promise<OpeningSamples> {
  await yieldSamples(signal);
  const blocks = openingSampleBlocks(seed, sampleRate);
  let deadline = performance.now() + 4;
  for (;;) {
    signal.throwIfAborted();
    const result = blocks.next();
    if (result.done) return result.value;
    if (performance.now() >= deadline) {
      await yieldSamples(signal);
      deadline = performance.now() + 4;
    }
  }
}

function workerSamples(seed: number, sampleRate: number, signal: AbortSignal): Promise<OpeningSamples> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let worker: Worker | undefined, url: string | undefined, settled = false;
    const finish = (samples?: OpeningSamples, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(samples!);
    };
    const abort = () => finish(undefined, signal.reason ?? new DOMException("Opening closed", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("Opening sample worker timed out")), 5000);
    signal.addEventListener("abort", abort, {once: true});
    try {
      url = URL.createObjectURL(new Blob([openingSampleWorkerSource()], {type: "text/javascript"}));
      worker = new Worker(url);
      worker.onmessage = event => {
        const value = event.data as OpeningSamples;
        if (value?.version !== 1 || value.seed !== seed || value.sampleRate !== sampleRate || !Array.isArray(value.impulse) || value.impulse.length !== 2 || value.impulse.some(channel => !(channel instanceof Float32Array) || channel.length !== Math.floor(sampleRate * 2.5)) || !(value.noise instanceof Float32Array) || value.noise.length !== sampleRate * 2) finish(undefined, new Error("Opening sample worker returned invalid samples"));
        else finish(value);
      };
      worker.onerror = event => { event.preventDefault(); finish(undefined, new Error("Opening sample worker failed")); };
      worker.onmessageerror = () => finish(undefined, new Error("Opening samples could not be transferred"));
      worker.postMessage({seed, sampleRate});
    } catch (error) { finish(undefined, error); }
  });
}

export async function prepareOpeningSampleData(seed: number, sampleRate: number, signal: AbortSignal) {
  if (typeof Worker !== "undefined") {
    try { return await workerSamples(seed, sampleRate, signal); }
    catch (error) { if (signal.aborted) throw error; }
  }
  return generateOpeningSamplesYielded(seed, sampleRate, signal);
}

type SampleEntry = {key: string; seed: number; sampleRate: number; controller: AbortController; listeners: Map<symbol, {resolve: (samples: OpeningSamples) => void; reject: (error: unknown) => void}>};
type SampleGenerator = (seed: number, sampleRate: number, signal: AbortSignal) => Promise<OpeningSamples>;

/** Admission control bounds active allocations as well as retained samples.
 * Each subscriber may leave without cancelling another opening's work. */
export class OpeningSampleCache {
  private retained = new Map<string, OpeningSamples>();
  private pending = new Map<string, SampleEntry>();
  private queue: SampleEntry[] = [];
  private active?: SampleEntry;
  private bytes = 0;
  constructor(private generate: SampleGenerator = prepareOpeningSampleData, private maxBytes = 8 * 1024 * 1024, private maxEntries = 4, private maxPending = 4) {}
  private key(seed: number, sampleRate: number) { return `1:${sampleRate}:${seed}`; }
  private size(samples: OpeningSamples) { return samples.noise.byteLength + samples.impulse.reduce((sum, channel) => sum + channel.byteLength, 0); }
  prepare(seed: number, sampleRate: number, signal: AbortSignal): Promise<OpeningSamples> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (!Number.isFinite(seed) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return Promise.reject(new Error("Unsupported opening sample configuration"));
    const key = this.key(seed, sampleRate), cached = this.retained.get(key);
    if (cached) { this.retained.delete(key); this.retained.set(key, cached); return Promise.resolve(cached); }
    let entry = this.pending.get(key);
    if (!entry) {
      if (this.pending.size >= this.maxPending) return Promise.reject(new Error("Opening preparation is busy. Try again."));
      entry = {key, seed, sampleRate, controller: new AbortController(), listeners: new Map()};
      this.pending.set(key, entry); this.queue.push(entry);
    }
    const owner = entry, token = Symbol(key);
    const result = new Promise<OpeningSamples>((resolve, reject) => {
      const abort = () => {
        owner.listeners.delete(token);
        reject(signal.reason ?? new DOMException("Opening closed", "AbortError"));
        if (!owner.listeners.size) {
          owner.controller.abort();
          if (this.pending.get(key) === owner) this.pending.delete(key);
          this.queue = this.queue.filter(candidate => candidate !== owner);
        }
      };
      const finish = (callback: () => void) => { signal.removeEventListener("abort", abort); callback(); };
      owner.listeners.set(token, {resolve: samples => finish(() => resolve(samples)), reject: error => finish(() => reject(error))});
      signal.addEventListener("abort", abort, {once: true});
      if (signal.aborted) abort();
    });
    this.pump();
    return result;
  }
  private pump() {
    if (this.active) return;
    const entry = this.queue.shift();
    if (!entry) return;
    if (entry.controller.signal.aborted || !entry.listeners.size) { this.pump(); return; }
    this.active = entry;
    void this.generate(entry.seed, entry.sampleRate, entry.controller.signal).then(samples => {
      if (entry.controller.signal.aborted || !entry.listeners.size) return;
      const size = this.size(samples);
      if (size <= this.maxBytes) {
        this.retained.set(entry.key, samples); this.bytes += size;
        while (this.bytes > this.maxBytes || this.retained.size > this.maxEntries) {
          const oldest = this.retained.entries().next().value;
          if (!oldest) break;
          this.retained.delete(oldest[0]); this.bytes -= this.size(oldest[1]);
        }
      }
      for (const listener of entry.listeners.values()) listener.resolve(samples);
    }, error => { for (const listener of entry.listeners.values()) listener.reject(error); }).finally(() => {
      entry.listeners.clear();
      if (this.pending.get(entry.key) === entry) this.pending.delete(entry.key);
      if (this.active === entry) this.active = undefined;
      this.pump();
    });
  }
  snapshot() { return {retained: this.retained.size, bytes: this.bytes, pending: this.pending.size, active: this.active ? 1 : 0, queued: this.queue.length}; }
}

export const openingSampleCache = new OpeningSampleCache();
