import { measureAudio } from "./analysis";

interface AnalysisRequest { id: number; sampleRate: number; channels: Float32Array[] }
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = event => {
  const { id, sampleRate, channels } = event.data;
  try {
    if (!Number.isSafeInteger(id) || !Array.isArray(channels) || channels.length < 1 || channels.length > 2
      || channels.some(channel => !(channel instanceof Float32Array))
      || channels.reduce((bytes, channel) => bytes + channel.byteLength, 0) > 96 * 1024 * 1024)
      throw new Error("Invalid audio analysis request");
    const measurements = measureAudio({ numberOfChannels: channels.length, sampleRate,
      length: channels[0].length, getChannelData: channel => channels[channel] });
    scope.postMessage({ id, measurements });
  } catch { scope.postMessage({ id, error: "This passage could not be measured." }); }
};
