import { comparisonGains, measuredWaveform, type AudioMetrics } from "./analysis";
import { AudioAnalysisSession } from "./analysisSession";
import { renderAudio, validateAudioBuffer } from "./engine";
import { audioTechnology, type AudioTechnology } from "./presets";

export interface AudioComparison {
  original: AudioBuffer; enhanced: AudioBuffer;
  originalWaveform: number[]; enhancedWaveform: number[];
  originalMetrics: AudioMetrics; enhancedMetrics: AudioMetrics;
  originalGain: number; enhancedGain: number; duration: number; mode: AudioTechnology;
}
/** Render only the requested mode. All processing and measurement stays on this device. */
export async function prepareComparison(buffer: AudioBuffer, value: AudioTechnology, options: { signal?: AbortSignal; analysis?: AudioAnalysisSession } = {}): Promise<AudioComparison> {
  if (options.signal?.aborted) throw options.signal.reason || new DOMException("Cancelled", "AbortError");
  validateAudioBuffer(buffer, 30, false); const mode = audioTechnology(value);
  const session = options.analysis ?? new AudioAnalysisSession();
  try {
    const original = await session.measure(buffer, options.signal);
    const enhanced = await renderAudio(buffer, mode, { signal: options.signal, samplesValidated: true });
    if (options.signal?.aborted) throw options.signal.reason || new DOMException("Cancelled", "AbortError");
    const processed = mode === "none" ? original : await session.measure(enhanced, options.signal);
    const originalMetrics = original.metrics, enhancedMetrics = processed.metrics;
    const { originalGain, enhancedGain } = comparisonGains(originalMetrics, enhancedMetrics);
    return { original: buffer, enhanced, originalMetrics, enhancedMetrics, originalGain, enhancedGain,
      originalWaveform: measuredWaveform(original.peaks, originalGain), enhancedWaveform: measuredWaveform(processed.peaks, enhancedGain), duration: buffer.duration, mode };
  } finally { if (!options.analysis) session.dispose(); }
}
