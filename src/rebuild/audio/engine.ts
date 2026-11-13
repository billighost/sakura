import { audioPreset, audioTechnology, dbToGain, type AudioTechnology } from "./presets";

export interface AudioGraph { output: AudioNode; dispose: () => void }
let protectionCurve: Float32Array<ArrayBuffer> | undefined;
function getProtectionCurve() {
  if (protectionCurve) return protectionCurve;
  const curve = new Float32Array(65537);
  for (let i = 0; i < curve.length; i++) {
    const value = i * 2 / (curve.length - 1) - 1;
    const magnitude = Math.abs(value);
    // Linear at normal levels; an emergency soft ceiling, not a true-peak limiter.
    curve[i] = magnitude <= 0.8 ? value : Math.sign(value) * (0.8 + 0.14 * Math.tanh((magnitude - 0.8) / 0.14));
  }
  protectionCurve = curve;
  return curve;
}

/** Shared by real-time playback and the comparison renderer. Never connects the destination. */
export function createAudioGraph(context: BaseAudioContext, source: AudioNode, mode: AudioTechnology): AudioGraph {
  const preset = audioPreset(mode), nodes: AudioNode[] = [];
  const input = context.createGain(); nodes.push(input); source.connect(input);
  let output: AudioNode = input;
  const append = (node: AudioNode) => { nodes.push(node); output.connect(node); output = node; };
  if (preset.id !== "none") {
    input.gain.value = dbToGain(preset.preampDb);
    for (const settings of preset.filters) {
      const filter = context.createBiquadFilter(); filter.type = settings.type;
      filter.frequency.value = Math.min(settings.frequency, context.sampleRate * 0.45);
      filter.gain.value = settings.gain; filter.Q.value = settings.q ?? Math.SQRT1_2;
      append(filter);
    }
    if (preset.crossfeed) {
      const { amount, frequency, delay } = preset.crossfeed;
      const stereo = context.createGain(); stereo.channelCount = 2; stereo.channelCountMode = "explicit"; stereo.channelInterpretation = "speakers"; append(stereo);
      const splitter = context.createChannelSplitter(2), merger = context.createChannelMerger(2);
      nodes.push(splitter, merger); output.connect(splitter);
      splitter.connect(merger, 0, 0); splitter.connect(merger, 1, 1);
      for (const ear of [0, 1]) {
        const low = context.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = frequency; low.Q.value = Math.SQRT1_2;
        const time = context.createDelay(0.001); time.delayTime.value = delay;
        const opposite = context.createGain(), same = context.createGain(); opposite.gain.value = amount; same.gain.value = -amount;
        nodes.push(low, time, opposite, same); splitter.connect(low, ear); low.connect(time); time.connect(opposite); time.connect(same);
        opposite.connect(merger, 0, 1 - ear); same.connect(merger, 0, ear);
      }
      // Differential crossfeed leaves the summed mono signal intact.
      output = merger;
    }
    if (preset.dynamics) {
      const compressor = context.createDynamicsCompressor(), settings = preset.dynamics;
      compressor.threshold.value = settings.threshold; compressor.knee.value = settings.knee; compressor.ratio.value = settings.ratio;
      compressor.attack.value = settings.attack; compressor.release.value = settings.release; append(compressor);
      const makeup = context.createGain(); makeup.gain.value = dbToGain(settings.makeupDb); append(makeup);
    }
    const protection = context.createWaveShaper(); protection.curve = getProtectionCurve(); protection.oversample = "none"; append(protection);
  }
  let disposed = false;
  return { output, dispose() { if (disposed) return; disposed = true; try { source.disconnect(input); } catch {} for (const node of nodes) { try { node.disconnect(); } catch {} } } };
}

function abort(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError"); }
export function validateAudioBuffer(buffer: AudioBuffer, maxDuration = 600, checkSamples = true) {
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || !buffer.length || buffer.duration > maxDuration || buffer.sampleRate < 8000 || buffer.sampleRate > 192000) throw new Error("Use a mono or stereo audio file within the listening preview limit.");
  if (!checkSamples) return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) throw new Error("This audio file contains invalid samples.");
  }
}

const compressorDelays = new Map<number, Promise<number>>();
/** Browser compressors include lookahead. Measure it rather than guessing a fixed offset. */
function compressorDelay(sampleRate: number): Promise<number> {
  const existing = compressorDelays.get(sampleRate); if (existing) return existing;
  const promise = (async () => {
    const context = new OfflineAudioContext(1, Math.ceil(sampleRate * 0.05), sampleRate);
    const impulse = context.createBuffer(1, 1, sampleRate); impulse.getChannelData(0)[0] = 0.01;
    const source = context.createBufferSource(), compressor = context.createDynamicsCompressor(); source.buffer = impulse;
    compressor.threshold.value = 0; compressor.knee.value = 0; compressor.ratio.value = 1;
    source.connect(compressor); compressor.connect(context.destination); source.start();
    const rendered = await context.startRendering(), data = rendered.getChannelData(0);
    const index = data.findIndex(value => Math.abs(value) > 0.000001);
    return index < 0 ? 0 : index;
  })(); compressorDelays.set(sampleRate, promise); return promise;
}

export async function renderAudio(buffer: AudioBuffer, mode: AudioTechnology, options: { signal?: AbortSignal; samplesValidated?: boolean } = {}): Promise<AudioBuffer> {
  // The comparison worker already scanned every immutable source sample.
  // Direct callers retain the full validation path.
  abort(options.signal); validateAudioBuffer(buffer, 600, !options.samplesValidated); const preset = audioPreset(mode);
  if (preset.id === "none") return buffer;
  const delay = preset.dynamics ? await compressorDelay(buffer.sampleRate) : 0; abort(options.signal);
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length + delay, buffer.sampleRate);
  const source = context.createBufferSource(); source.buffer = buffer;
  const graph = createAudioGraph(context, source, mode); graph.output.connect(context.destination); source.start();
  try {
    const rendered = await context.startRendering(); abort(options.signal);
    const result = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) result.copyToChannel(rendered.getChannelData(channel).subarray(delay, delay + buffer.length), channel);
    return result;
  } finally { graph.dispose(); source.disconnect(); }
}

interface Branch { graph: AudioGraph; fader: GainNode; timer?: ReturnType<typeof setTimeout> }
interface PlaybackSessionHost { audioSession?: { type: string } }
/** Safari otherwise treats Web Audio as ambient sound and may interrupt it
 * when the installed app goes into the background. Unsupported browsers keep
 * their native media behavior. Claim playback before creating an audio graph. */
export function configurePlaybackAudioSession(host: PlaybackSessionHost | undefined = typeof navigator === "undefined" ? undefined : navigator as PlaybackSessionHost): boolean {
  try { if (!host?.audioSession) return false; host.audioSession.type = "playback"; return host.audioSession.type === "playback"; } catch { return false; }
}
/** iOS keeps HTMLMediaElement.volume fixed; a dry Web Audio gain controls listening level. */
export function needsMediaVolumeGain(device: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> = navigator) {
  return /iPad|iPhone|iPod/i.test(device.userAgent) || device.platform === "MacIntel" && device.maxTouchPoints > 1;
}
/** A media element can have only one source node for its lifetime. Reuse this controller. */
export class MediaAudioEngine {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private master: GainNode | null = null;
  private volume: number;
  private branches = new Set<Branch>();
  private mode: AudioTechnology = "none";
  private closed = false;
  private readonly recover = () => {
    if (this.closed || this.element.paused || this.element.ended) return;
    configurePlaybackAudioSession();
    // A suspended/interrupted graph is silent even while the native media
    // element continues to advance. Recover the existing graph, never reload
    // the recording or override a deliberate pause.
    void this.resume().catch(() => {});
  };
  readonly requiresVolumeGraph: boolean;
  constructor(private readonly element: HTMLMediaElement, options: { requiresVolumeGraph?: boolean } = {}) {
    this.volume = element.volume;
    this.requiresVolumeGraph = options.requiresVolumeGraph ?? needsMediaVolumeGain();
    element.addEventListener("play", this.recover);
    element.addEventListener("playing", this.recover);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.recover);
    if (typeof window !== "undefined") window.addEventListener("pageshow", this.recover);
    if (typeof navigator !== "undefined") navigator.mediaDevices?.addEventListener("devicechange", this.recover);
  }
  get initialized() { return this.context !== null; }
  get currentMode() { return this.mode; }
  async resume(): Promise<void> {
    if (this.closed) return;
    configurePlaybackAudioSession();
    const context = this.context;
    if (!context || !["suspended", "interrupted"].includes(context.state as string)) return;
    // Safari can leave a background resume promise pending. A later foreground
    // gesture must issue its own resume call instead of waiting behind it.
    await context.resume();
  }
  /** Listening volume belongs after dynamics, so changing volume doesn't change the sound. */
  setVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (!this.master || !this.context) { this.element.volume = this.volume; return; }
    const param = this.master.gain, now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else { const current = param.value; param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
    param.linearRampToValueAtTime(this.volume, now + 0.012);
  }
  /** Call from a user gesture, after selecting a same-origin/blob or explicitly CORS-enabled source. */
  async setMode(value: AudioTechnology): Promise<void> {
    if (this.closed) return;
    configurePlaybackAudioSession();
    const mode = audioTechnology(value);
    if (!this.context && mode === "none" && !this.requiresVolumeGraph) { this.mode = mode; return; }
    if (!this.context) {
      // src reflects a deliberate source migration immediately; currentSrc may
      // still name the preceding CDN resource until the new load is selected.
      const address = this.element.src || this.element.currentSrc;
      if (address) {
        const url = new URL(address, location.href);
        if (url.origin !== location.origin && !["blob:", "data:"].includes(url.protocol) && this.element.crossOrigin !== "anonymous" && this.element.crossOrigin !== "use-credentials") throw new Error("This audio source needs a same-origin connection before enhancement can be enabled.");
      }
      const Constructor = globalThis.AudioContext;
      if (!Constructor) throw new Error("Audio technology is unavailable in this browser.");
      this.context = new Constructor({ latencyHint: "playback" });
      this.context.addEventListener("statechange", this.recover);
      try { this.source = this.context.createMediaElementSource(this.element); }
      catch (error) { this.context.removeEventListener("statechange", this.recover); void this.context.close(); this.context = null; throw error; }
      // Keep the requested level: on iOS the element getter always returns 1.
      this.master = this.context.createGain(); this.master.gain.value = this.volume; this.master.connect(this.context.destination);
      this.element.volume = 1;
      // Preserve dry playback immediately when media routing changes.
      const graph = createAudioGraph(this.context, this.source, "none"), fader = this.context.createGain();
      graph.output.connect(fader); fader.connect(this.master); this.branches.add({ graph, fader });
    }
    const context = this.context, source = this.source;
    if (!source) return;
    // Invoke resume synchronously before any await so browser gesture activation survives.
    const resumed = this.resume();
    if (mode !== this.mode) {
      const now = context.currentTime, ramp = 0.06;
      for (const branch of this.branches) {
        if (branch.timer) clearTimeout(branch.timer);
        const param = branch.fader.gain;
        if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
        else { const current = param.value; param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
        param.linearRampToValueAtTime(0, now + ramp);
        const retire = () => {
          // Audio time can stop when the browser suspends a background context.
          if (!this.closed && context.state !== "closed" && context.currentTime < now + ramp) { branch.timer = setTimeout(retire, 100); return; }
          branch.graph.dispose(); branch.fader.disconnect(); this.branches.delete(branch);
        };
        branch.timer = setTimeout(retire, 90);
      }
      const graph = createAudioGraph(context, source, mode), fader = context.createGain(); fader.gain.value = 0;
      graph.output.connect(fader); fader.connect(this.master!); fader.gain.setValueAtTime(0, now); fader.gain.linearRampToValueAtTime(1, now + ramp);
      this.branches.add({ graph, fader }); this.mode = mode;
    }
    await resumed;
  }
  dispose() {
    if (this.closed) return; this.closed = true;
    this.element.removeEventListener("play", this.recover); this.element.removeEventListener("playing", this.recover);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.recover);
    if (typeof window !== "undefined") window.removeEventListener("pageshow", this.recover);
    if (typeof navigator !== "undefined") navigator.mediaDevices?.removeEventListener("devicechange", this.recover);
    this.context?.removeEventListener("statechange", this.recover);
    for (const branch of this.branches) { if (branch.timer) clearTimeout(branch.timer); branch.graph.dispose(); branch.fader.disconnect(); }
    this.branches.clear(); this.source?.disconnect(); this.master?.disconnect(); this.element.volume = this.volume; void this.context?.close().catch(() => {}); this.context = null; this.source = null; this.master = null;
  }
}
