import { analyseAudio, audioWaveform, comparisonGains, type AudioMetrics } from "./analysis";
import { renderAudio, validateAudioBuffer } from "./engine";
import { audioTechnology, type AudioTechnology } from "./presets";

export interface AudioComparison {
  original: AudioBuffer; enhanced: AudioBuffer;
  originalWaveform: number[]; enhancedWaveform: number[];
  originalMetrics: AudioMetrics; enhancedMetrics: AudioMetrics;
  originalGain: number; enhancedGain: number; duration: number; mode: AudioTechnology;
}
/** Render only the requested mode. All processing and measurement stays on this device. */
export async function prepareComparison(buffer: AudioBuffer, value: AudioTechnology, options: { signal?: AbortSignal } = {}): Promise<AudioComparison> {
  if (options.signal?.aborted) throw options.signal.reason || new DOMException("Cancelled", "AbortError");
  validateAudioBuffer(buffer, 30); const mode = audioTechnology(value);
  const enhanced = await renderAudio(buffer, mode, options);
  if (options.signal?.aborted) throw options.signal.reason || new DOMException("Cancelled", "AbortError");
  const originalMetrics = analyseAudio(buffer), enhancedMetrics = mode === "none" ? originalMetrics : analyseAudio(enhanced);
  const { originalGain, enhancedGain } = comparisonGains(originalMetrics, enhancedMetrics);
  return { original: buffer, enhanced, originalMetrics, enhancedMetrics, originalGain, enhancedGain, originalWaveform: audioWaveform(buffer, originalGain), enhancedWaveform: audioWaveform(enhanced, enhancedGain), duration: buffer.duration, mode };
}
