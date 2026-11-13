import { measureAudioAsync, type AudioMeasurements, type SampleBuffer } from "./analysis";

interface AnalysisJob {
  id: number; buffer: SampleBuffer; signal?: AbortSignal; controller: AbortController;
  resolve: (value: AudioMeasurements) => void; reject: (error: unknown) => void;
  abort: () => void; timer?: ReturnType<typeof setTimeout>;
}
const canceled = () => new DOMException("Audio preparation canceled", "AbortError");
// Keep the literal worker entry in a module function: Turbopack otherwise
// treats the URL inside a constructor default parameter as a raw static asset.
function createAnalysisWorker() {
  return new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
}

/** One dialog owns one worker and small results for its immutable AudioBuffers.
 * A canceled active job terminates its worker; queued consumers get a new one. */
export class AudioAnalysisSession {
  private cache = new WeakMap<SampleBuffer, AudioMeasurements>();
  private jobs: AnalysisJob[] = [];
  private active: AnalysisJob | undefined;
  private worker: Worker | undefined;
  private unsupported = false;
  private closed = false;
  private sequence = 0;
  constructor(private readonly workerFactory: () => Worker = createAnalysisWorker) {}

  measure(buffer: SampleBuffer, signal?: AbortSignal): Promise<AudioMeasurements> {
    signal?.throwIfAborted();
    if (this.closed) return Promise.reject(canceled());
    const cached = this.cache.get(buffer); if (cached) return Promise.resolve(cached);
    if (this.jobs.length >= 4) return Promise.reject(new Error("Audio preparation is already busy."));
    return new Promise((resolve, reject) => {
      const job: AnalysisJob = { id: ++this.sequence, buffer, signal, controller: new AbortController(), resolve, reject, abort: () => {
        job.controller.abort(signal?.reason ?? canceled());
        if (this.active === job) { this.worker?.terminate(); this.worker = undefined; this.finish(job, undefined, signal?.reason ?? canceled()); }
        else { this.jobs = this.jobs.filter(item => item !== job); signal?.removeEventListener("abort", job.abort); reject(signal?.reason ?? canceled()); }
      } };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.jobs.push(job); this.start();
      if (signal?.aborted) job.abort();
    });
  }

  private start() {
    if (this.closed || this.active) return;
    const job = this.jobs.shift(); if (!job) return;
    this.active = job;
    const bytes = job.buffer.length * job.buffer.numberOfChannels * 4;
    if (!Number.isSafeInteger(job.buffer.length) || job.buffer.length <= 0 || !Number.isInteger(job.buffer.numberOfChannels)
      || job.buffer.numberOfChannels < 1 || job.buffer.numberOfChannels > 2
      || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 96 * 1024 * 1024) {
      this.finish(job, undefined, new Error("This passage is too large to prepare.")); return;
    }
    if (!this.unsupported && !this.worker) {
      try {
        this.worker = this.workerFactory();
        this.worker.onmessage = event => {
          const current = this.active, response = event.data;
          if (!current || response?.id !== current.id) return;
          const value = response.measurements as AudioMeasurements | undefined;
          if (!value || !Array.isArray(value.peaks) || value.peaks.length !== 160
            || value.peaks.some(peak => !Number.isFinite(peak) || peak < 0) || !value.metrics
            || [value.metrics.loudnessLufs, value.metrics.peakDbfs, value.metrics.rmsDbfs, value.metrics.crestDb]
              .some(metric => metric !== null && !Number.isFinite(metric))) {
            this.finish(current, undefined, new Error("This passage could not be measured.")); return;
          }
          this.finish(current, value);
        };
        this.worker.onerror = () => this.fallback();
      } catch { this.unsupported = true; }
    }
    if (!this.worker) { this.fallback(); return; }
    void this.dispatch(job);
  }

  private async dispatch(job: AnalysisJob) {
    const worker = this.worker;
    try {
      const channels: Float32Array<ArrayBuffer>[] = [];
      let deadline = performance.now() + 8;
      for (let channel = 0; channel < job.buffer.numberOfChannels; channel++) {
        const source = job.buffer.getChannelData(channel), copy = new Float32Array(source.length);
        if (source.length !== job.buffer.length) throw new Error("Audio sample dimensions do not match.");
        for (let offset = 0; offset < source.length; offset += 65536) {
          job.controller.signal.throwIfAborted();
          copy.set(source.subarray(offset, offset + 65536), offset);
          if (performance.now() >= deadline) {
            const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
            if (scheduler?.yield) await scheduler.yield();
            else await new Promise<void>(resolve => setTimeout(resolve, 0));
            deadline = performance.now() + 8;
          }
        }
        channels.push(copy);
      }
      job.controller.signal.throwIfAborted();
      if (this.active !== job || this.worker !== worker || !worker) return;
      worker.postMessage({ id: job.id, sampleRate: job.buffer.sampleRate, channels }, channels.map(channel => channel.buffer));
      job.timer = setTimeout(() => this.fallback(), 30_000);
    } catch (error) { this.finish(job, undefined, error); }
  }

  private fallback() {
    const job = this.active; if (!job) return;
    this.worker?.terminate(); this.worker = undefined; this.unsupported = true;
    clearTimeout(job.timer); job.timer = undefined;
    void measureAudioAsync(job.buffer, job.controller.signal).then(value => this.finish(job, value), error => this.finish(job, undefined, error));
  }

  private finish(job: AnalysisJob, value?: AudioMeasurements, error?: unknown) {
    if (this.active !== job) return;
    clearTimeout(job.timer); job.signal?.removeEventListener("abort", job.abort); this.active = undefined;
    if (error !== undefined || job.signal?.aborted) job.reject(error ?? job.signal?.reason ?? canceled());
    else if (value) { this.cache.set(job.buffer, value); job.resolve(value); }
    else job.reject(new Error("This passage could not be measured."));
    this.start();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true; this.worker?.terminate(); this.worker = undefined;
    const jobs = this.active ? [this.active, ...this.jobs] : this.jobs;
    this.active = undefined; this.jobs = []; this.cache = new WeakMap();
    for (const job of jobs) { job.controller.abort(canceled()); clearTimeout(job.timer); job.signal?.removeEventListener("abort", job.abort); job.reject(canceled()); }
  }
}
