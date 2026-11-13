import { dbToGain } from "./presets";

export interface AudioMetrics { loudnessLufs: number | null; peakDbfs: number | null; rmsDbfs: number | null; crestDb: number | null }
export interface SampleBuffer { numberOfChannels: number; sampleRate: number; length: number; getChannelData: (channel: number) => Float32Array }
export interface AudioMeasurements { metrics: AudioMetrics; peaks: number[] }
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }
function kFilters(sampleRate: number): [Biquad, Biquad] {
  // ITU-R BS.1770 K-weighting, De Man coefficients (not an A-weighted/RMS proxy).
  let k = Math.tan(Math.PI * 1681.974450955533 / sampleRate), q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  let denominator = 1 + k / q + k * k;
  const shelf: Biquad = { b0: (vh + vb * k / q + k * k) / denominator, b1: 2 * (k * k - vh) / denominator, b2: (vh - vb * k / q + k * k) / denominator, a1: 2 * (k * k - 1) / denominator, a2: (1 - k / q + k * k) / denominator, x1: 0, x2: 0, y1: 0, y2: 0 };
  k = Math.tan(Math.PI * 38.13547087602444 / sampleRate); q = 0.5003270373238773; denominator = 1 + k / q + k * k;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / denominator, a2: (1 - k / q + k * k) / denominator, x1: 0, x2: 0, y1: 0, y2: 0 };
  return [shelf, highpass];
}
function filter(value: number, state: Biquad): number {
  const output = state.b0 * value + state.b1 * state.x1 + state.b2 * state.x2 - state.a1 * state.y1 - state.a2 * state.y2;
  state.x2 = state.x1; state.x1 = value; state.y2 = state.y1; state.y1 = output; return output;
}
const energyToLufs = (energy: number) => -0.691 + 10 * Math.log10(energy);
const amplitudeDb = (value: number) => value > 0 ? 20 * Math.log10(value) : null;

/** Measure raw bin peaks with loudness in one pass. Chunk boundaries keep the
 * same accumulation order as analyseAudio while allowing a yielding fallback. */
function* measurementChunks(buffer: SampleBuffer): Generator<void, AudioMeasurements> {
  if (!Number.isSafeInteger(buffer.length) || buffer.length <= 0 || !Number.isInteger(buffer.numberOfChannels)
    || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || !Number.isFinite(buffer.sampleRate)
    || buffer.sampleRate < 8000 || buffer.sampleRate > 192000)
    throw new Error("A valid mono or stereo buffer is required.");
  const weightedPrefix = new Float64Array(buffer.length + 1), peaks = Array<number>(160).fill(0);
  let peak = 0, sumSquares = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel), [shelf, highpass] = kFilters(buffer.sampleRate);
    if (samples.length !== buffer.length) throw new Error("Audio sample dimensions do not match.");
    let accumulated = 0;
    for (let from = 0; from < buffer.length; from += 4096) {
      for (let i = from, end = Math.min(buffer.length, from + 4096); i < end; i++) {
        const value = samples[i]; if (!Number.isFinite(value)) throw new Error("Audio samples must be finite.");
        const magnitude = Math.abs(value), bin = Math.min(159, Math.floor(i * 160 / buffer.length));
        peak = Math.max(peak, magnitude); peaks[bin] = Math.max(peaks[bin], magnitude); sumSquares += value * value;
        const weighted = filter(filter(value, shelf), highpass); accumulated += weighted * weighted;
        weightedPrefix[i + 1] += accumulated;
      }
      yield;
    }
  }
  const block = Math.min(buffer.length, Math.round(buffer.sampleRate * .4)), hop = Math.max(1, Math.round(buffer.sampleRate * .1));
  const absolute: number[] = [];
  for (let start = 0; start + block <= buffer.length; start += hop) {
    const energy = Math.max(0, (weightedPrefix[start + block] - weightedPrefix[start]) / block);
    if (energy > 0 && energyToLufs(energy) >= -70) absolute.push(energy);
  }
  let loudnessLufs: number | null = null;
  if (absolute.length) {
    const relative = absolute.reduce((sum, value) => sum + value, 0) / absolute.length / 10;
    const gated = absolute.filter(value => value >= relative);
    if (gated.length) loudnessLufs = energyToLufs(gated.reduce((sum, value) => sum + value, 0) / gated.length);
  }
  const rmsDbfs = amplitudeDb(Math.sqrt(sumSquares / (buffer.length * buffer.numberOfChannels))), peakDbfs = amplitudeDb(peak);
  return { metrics: { loudnessLufs, peakDbfs, rmsDbfs, crestDb: peakDbfs !== null && rmsDbfs !== null ? peakDbfs - rmsDbfs : null }, peaks };
}

export function measureAudio(buffer: SampleBuffer): AudioMeasurements {
  const chunks = measurementChunks(buffer);
  for (;;) { const next = chunks.next(); if (next.done) return next.value; }
}

/** Used only when module workers are unavailable. Keep cancellation and input
 * responsiveness instead of replacing an unsupported worker with a long task. */
export async function measureAudioAsync(buffer: SampleBuffer, signal?: AbortSignal): Promise<AudioMeasurements> {
  const chunks = measurementChunks(buffer);
  let deadline = performance.now() + 8;
  for (;;) {
    signal?.throwIfAborted();
    const next = chunks.next(); if (next.done) return next.value;
    if (performance.now() >= deadline) {
      const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
      if (scheduler?.yield) await scheduler.yield();
      else await new Promise<void>(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 8;
    }
  }
}

export function measuredWaveform(peaks: readonly number[], gain: number): number[] {
  return peaks.map(value => Math.min(1, Math.abs(value * gain)));
}

/** Integrated gated K-weighted loudness for mono/stereo. Clips under 400 ms use a single short block. */
export function analyseAudio(buffer: SampleBuffer): AudioMetrics {
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || !buffer.length || buffer.sampleRate < 8000 || buffer.sampleRate > 192000) throw new Error("A valid mono or stereo buffer is required.");
  const weightedPrefix = new Float64Array(buffer.length + 1);
  let peak = 0, sumSquares = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel), [shelf, highpass] = kFilters(buffer.sampleRate);
    let accumulated = 0;
    for (let i = 0; i < buffer.length; i++) {
      const value = samples[i]; if (!Number.isFinite(value)) throw new Error("Audio samples must be finite.");
      peak = Math.max(peak, Math.abs(value)); sumSquares += value * value;
      const weighted = filter(filter(value, shelf), highpass); accumulated += weighted * weighted; weightedPrefix[i + 1] += accumulated;
    }
  }
  const block = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.4)), hop = Math.max(1, Math.round(buffer.sampleRate * 0.1)), absolute: number[] = [];
  for (let start = 0; start + block <= buffer.length; start += hop) {
    const energy = Math.max(0, (weightedPrefix[start + block] - weightedPrefix[start]) / block);
    if (energy > 0 && energyToLufs(energy) >= -70) absolute.push(energy);
  }
  let loudnessLufs: number | null = null;
  if (absolute.length) {
    const relativeEnergy = absolute.reduce((sum, value) => sum + value, 0) / absolute.length / 10;
    const gated = absolute.filter(value => value >= relativeEnergy);
    if (gated.length) loudnessLufs = energyToLufs(gated.reduce((sum, value) => sum + value, 0) / gated.length);
  }
  const rmsDbfs = amplitudeDb(Math.sqrt(sumSquares / (buffer.length * buffer.numberOfChannels))), peakDbfs = amplitudeDb(peak);
  return { loudnessLufs, peakDbfs, rmsDbfs, crestDb: peakDbfs !== null && rmsDbfs !== null ? peakDbfs - rmsDbfs : null };
}

/** Both sides aim for the quieter measured loudness; peak protection may lower that common target. */
export function comparisonGains(original: AudioMetrics, enhanced: AudioMetrics, ceilingDbfs = -1): { originalGain: number; enhancedGain: number } {
  if (original.loudnessLufs === null || enhanced.loudnessLufs === null) {
    // A sparse transient can fall outside an integrated loudness block. Keep
    // its sample headroom safe without inventing a loudness measurement.
    const commonGain = Math.min(1, ...[original, enhanced].map(metrics => metrics.peakDbfs === null ? 1 : dbToGain(ceilingDbfs - metrics.peakDbfs)));
    return { originalGain: commonGain, enhancedGain: commonGain };
  }
  let target = Math.min(original.loudnessLufs, enhanced.loudnessLufs);
  for (const metrics of [original, enhanced]) if (metrics.peakDbfs !== null && metrics.loudnessLufs !== null) target = Math.min(target, metrics.loudnessLufs + ceilingDbfs - metrics.peakDbfs);
  return { originalGain: dbToGain(target - original.loudnessLufs), enhancedGain: dbToGain(target - enhanced.loudnessLufs) };
}

/** Maximum absolute amplitude per bin, including audition gain, shared 0..1 scale on both sides. */
export function audioWaveform(buffer: SampleBuffer, gain = 1, bins = 160): number[] {
  const count = Math.max(1, Math.min(1024, Math.floor(bins))), result = Array<number>(count).fill(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) { const bin = Math.min(count - 1, Math.floor(i * count / buffer.length)); result[bin] = Math.max(result[bin], Math.min(1, Math.abs(samples[i] * gain))); }
  }
  return result;
}

/** PCM16 WAV download of the exact audition result. */
export function encodeAudioWav(buffer: SampleBuffer, gain = 1): Uint8Array<ArrayBuffer> {
  const channels = buffer.numberOfChannels, bytes = new Uint8Array(44 + buffer.length * channels * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes.length - 44, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < buffer.length; frame++) for (let channel = 0; channel < channels; channel++) { const sample = Math.max(-1, Math.min(1, data[channel][frame] * gain)); view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return bytes;
}
