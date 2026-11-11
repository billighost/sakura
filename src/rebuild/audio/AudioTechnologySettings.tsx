"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import {PlaybackRibbon,VolumeControl} from "../app/ListeningControls";
import { useMusic } from "../app/MusicContext";
import { SelectPopover } from "../app/SelectPopover";
import { PlayerDialog, PlayerIcon } from "../player/Primitives";
import { AUDIO_TECHNOLOGIES, audioTechnology, type AudioTechnology } from "./presets";
import { prepareComparison, type AudioComparison } from "./preview";
import s from "./audio-technology.module.css";

const MAX_BYTES = 20 * 1024 * 1024;
const EXCERPT_SECONDS = 24;
type Side = "original" | "enhanced";
type Example = { title: string; url: string; duration?: number };
type AudibleSource = { source: AudioBufferSourceNode; gain: GainNode };

function SoundMark({ mode, large = false }: { mode: AudioTechnology; large?: boolean }) {
  const shape: Record<AudioTechnology, number[]> = {
    none: [8, 8, 8, 8, 8, 8, 8], clarity: [8, 12, 19, 26, 22, 16, 12],
    warmth: [25, 23, 20, 16, 12, 9, 6], punch: [27, 14, 24, 10, 22, 13, 20],
    night: [11, 14, 16, 18, 16, 14, 11], headphones: [22, 17, 12, 8, 12, 17, 22],
  };
  return <svg className={large ? s.largeMark : s.soundMark} viewBox="0 0 68 42" fill="none" aria-hidden="true">
    {shape[mode].map((height, i) => <path key={i} d={`M${10 + i * 8} ${21 - height / 2}v${height}`} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>)}
  </svg>;
}

export function AudioTechnologySettings() {
  const music = useMusic();
  const selected = audioTechnology(music.settings.audioTechnology);
  const name = useId();
  const [preview, setPreview] = useState<{ context: AudioContext | null; accountId: string | null } | null>(null);

  async function change(mode: AudioTechnology) {
    try { await music.updateSettings({ audioTechnology: mode }); }
    catch (error) { music.reportError(error, "save", () => void change(mode)); }
  }
  function openPreview() {
    music.pause();
    let context: AudioContext | null = null;
    try {
      const Constructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Constructor) {
        context = new Constructor();
        // Resume starts in this click, before decoding or rendering any audio.
        void context.resume().catch(() => {});
      }
    } catch { /* The dialog offers a clear unsupported-browser state. */ }
    setPreview({ context, accountId: music.account?.id || null });
  }

  return <section className={s.settings} aria-labelledby={name + "-title"}>
    <div className={s.sectionHeading}>
      <div><span className={s.eyebrow}>A LITTLE MORE IN EVERY NOTE</span><h2 id={name + "-title"}>Audio technology</h2><p>Adjust the sound. Compare styles and choose what you prefer.</p></div>
      <SoundMark mode={selected} large/>
    </div>
    <fieldset className={s.presets}>
      <legend className={s.srOnly}>Audio technology</legend>
      {AUDIO_TECHNOLOGIES.map(preset => <label key={preset.id} className={s.preset + (selected === preset.id ? " " + s.selected : "")}>
        <input type="radio" name={name + "-technology"} value={preset.id} checked={selected === preset.id} onChange={() => void change(preset.id)}/>
        <SoundMark mode={preset.id}/><span><b>{preset.name}</b><small>{preset.description}</small></span><span className={s.radioMark} aria-hidden="true"/>
      </label>)}
    </fieldset>
    <div className={s.previewPrompt}><p>{AUDIO_TECHNOLOGIES.find(preset => preset.id === selected)?.detail}</p><button type="button" className={s.previewButton} onClick={openPreview}><PlayerIcon name="play" size={17}/><span>Preview the difference</span></button></div>
    {preview && preview.accountId === (music.account?.id || null) && <AudioPreview key={preview.accountId} context={preview.context} initialMode={selected} onClose={() => setPreview(null)}/>}
  </section>;
}

function AudioPreview({ context, initialMode, onClose }: { context: AudioContext | null; initialMode: AudioTechnology; onClose: () => void }) {
  const music = useMusic();
  const [mode, setMode] = useState(initialMode);
  const [comparison, setComparison] = useState<AudioComparison | null>(null);
  const [example, setExample] = useState<Example | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(Boolean(context));
  const [message, setMessage] = useState("Finding a song to compare…");
  const [error, setError] = useState<string | null>(context ? null : "Audio previews need a browser with Web Audio support. Try a recent version of Chrome, Safari, Firefox, or Edge.");
  const [playing, setPlaying] = useState<Side | null>(null);
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState(music.settings.previewLoop??true);
  const [volume, setVolume] = useState(music.settings.previewVolume??.8);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sourceBuffer = useRef<AudioBuffer | null>(null);
  const comparisons = useRef(new Map<AudioTechnology, AudioComparison>());
  const currentComparison = useRef<AudioComparison | null>(null);
  const currentMode = useRef(mode);
  const audible = useRef<AudibleSource | null>(null);
  const playingSide = useRef<Side | null>(null);
  const lastAudition = useRef<Side>("enhanced");
  const playCounter = useRef(0);
  const offset = useRef(0);
  const startedAt = useRef(0);
  const currentLoop = useRef(loop);
  const currentVolume = useRef(volume);
  const frame = useRef<number | null>(null);
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const preset = AUDIO_TECHNOLOGIES.find(value => value.id === mode)!;

  function cursor() {
    const duration = currentComparison.current?.duration || 0;
    const elapsed = playingSide.current && context ? Math.max(0, context.currentTime - startedAt.current) : 0;
    const raw = offset.current + elapsed;
    return duration ? currentLoop.current ? raw % duration : Math.min(raw, duration) : 0;
  }
  function stop(update = true) {
    offset.current = cursor();
    playCounter.current++;
    playingSide.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const old = audible.current;
    audible.current = null;
    if (old && context) {
      const now = context.currentTime;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + .012);
      try { old.source.stop(now + .015); } catch { /* Already ended. */ }
    }
    if (update && mounted.current) { setPlaying(null); setPosition(offset.current); }
  }
  function follow() {
    let last = 0;
    const tick = (now: number) => {
      if (!mounted.current || !playingSide.current) return;
      if (now - last >= 70) { last = now; setPosition(cursor()); }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function launch(side: Side, at: number) {
    const prepared = currentComparison.current;
    if (!context || !prepared || !mounted.current) return;
    stop(false);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const duration = prepared.duration;
    offset.current = at >= duration - .015 ? 0 : Math.max(0, at);
    source.buffer = side === "original" ? prepared.original : prepared.enhanced;
    source.loop = currentLoop.current;
    source.loopEnd = duration;
    const level = (side === "original" ? prepared.originalGain : prepared.enhancedGain) * currentVolume.current;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(level, context.currentTime + .012);
    source.connect(gain); gain.connect(context.destination);
    const node = { source, gain };
    audible.current = node;
    playingSide.current = side;
    lastAudition.current = side;
    startedAt.current = context.currentTime;
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (audible.current !== node || !mounted.current) return;
      audible.current = null; playingSide.current = null;
      offset.current = duration;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setPosition(duration); setPlaying(null);
    };
    source.start(context.currentTime, offset.current);
    setPlaying(side); setPosition(offset.current); follow();
  }
  async function play(side: Side) {
    if (!context || !currentComparison.current || busy) return;
    if (playingSide.current === side) { stop(); return; }
    const token = ++playCounter.current;
    const at = cursor();
    try {
      music.pause();
      await context.resume();
      if (token !== playCounter.current || !mounted.current) return;
      setError(null); launch(side, at);
    } catch { if (mounted.current) setError("The preview couldn’t start. Tap play again to let your browser enable audio."); }
  }
  function seek(at: number) {
    const side = playingSide.current;
    stop(); offset.current = at; setPosition(at);
    if (side) launch(side, at);
  }
  function begin(message: string, reset: boolean) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const token = ++operation.current;
    stop(); setBusy(true); setError(null); setMessage(message);
    if (reset) {
      sourceBuffer.current = null; comparisons.current.clear(); currentComparison.current = null;
      setComparison(null); offset.current = 0; setPosition(0);
    }
    return { token, controller };
  }
  function active(token: number) { return mounted.current && token === operation.current; }
  async function prepare(buffer: AudioBuffer, token: number, signal: AbortSignal, resumeSide: Side | null = null) {
    const target = currentMode.current;
    const prepared = comparisons.current.get(target) || await prepareComparison(buffer, target, { signal });
    if (!active(token) || signal.aborted) return;
    comparisons.current.set(target, prepared); currentComparison.current = prepared;
    setComparison(prepared); setBusy(false); setMessage("");
    if (resumeSide && context?.state === "running" && !document.hidden) launch(resumeSide, offset.current);
  }
  function excerpt(decoded: AudioBuffer, start: number) {
    if (!context) throw new Error("unsupported");
    if (decoded.duration > 480 || decoded.numberOfChannels > 2) throw new Error("length");
    const from = Math.max(0, Math.min(start, Math.max(0, decoded.duration - EXCERPT_SECONDS)));
    const begin = Math.floor(from * decoded.sampleRate);
    const length = Math.min(Math.round(EXCERPT_SECONDS * decoded.sampleRate), decoded.length - begin);
    if (length < decoded.sampleRate / 2) throw new Error("short");
    const result = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) result.getChannelData(channel).set(decoded.getChannelData(channel).subarray(begin, begin + length));
    return result;
  }
  function failure(reason: unknown, fallback: string) {
    const code = reason instanceof Error ? reason.message : "";
    return code === "size" ? "Choose an audio file smaller than 20 MB." : code === "length" ? "Choose a mono or stereo song shorter than eight minutes." : code === "short" ? "Choose a song with at least half a second of audio." : fallback;
  }
  async function decode(bytes: ArrayBuffer, title: string, start: number | null, token: number, signal: AbortSignal) {
    if (!context || !active(token)) return;
    setMessage("Preparing the same passage in both styles…");
    const decoded = await context.decodeAudioData(bytes);
    if (!active(token) || signal.aborted) return;
    const buffer = excerpt(decoded, start === null ? Math.min(30, decoded.duration * .2) : start);
    sourceBuffer.current = buffer; setTitle(title);
    await prepare(buffer, token, signal);
  }
  async function readResponse(response: Response, signal: AbortSignal) {
    if (!response.ok) throw new Error("fetch");
    const declared = Number(response.headers.get("Content-Length"));
    if (declared > MAX_BYTES) throw new Error("size");
    if (!response.body) throw new Error("fetch");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        if (signal.aborted) throw signal.reason;
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error("size");
        parts.push(value);
      }
    } catch (reason) { await reader.cancel().catch(() => {}); throw reason; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let position = 0;
    for (const part of parts) { bytes.set(part, position); position += part.byteLength; }
    return bytes.buffer;
  }
  async function remote(song: Example, candidates: string[] = [song.url], start = 0) {
    if (!context) return;
    const { token, controller } = begin("Opening your comparison song…", true);
    setTitle(song.title);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      let bytes: ArrayBuffer | null = null;
      for (const candidate of [...new Set(candidates)]) {
        if (controller.signal.aborted) break;
        try {
          const url = new URL(candidate, location.href);
          const sameOrigin = url.origin === location.origin;
          const response = await fetch(url, { signal: controller.signal, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin && music.account ? { "X-Sakura-Account": music.account.id } : undefined });
          bytes = await readResponse(response, controller.signal); break;
        } catch (reason) { if (reason instanceof Error && reason.message === "size") throw reason; }
      }
      if (!bytes) throw new Error("fetch");
      await decode(bytes, song.title, start, token, controller.signal);
    } catch (reason) {
      if (!active(token) || (controller.signal.aborted && !timedOut)) return;
      setBusy(false); setMessage("");
      setError(failure(reason, timedOut ? "The song took too long to open. Try again, or choose an audio file from this device." : "This song couldn’t be opened for a preview. Choose an audio file from this device and try again."));
    } finally { clearTimeout(timer); }
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !context) return;
    const { token, controller } = begin("Opening your audio file…", true);
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    try {
      if (file.size > MAX_BYTES) throw new Error("size");
      await context.resume();
      await decode(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""), null, token, controller.signal);
    } catch (reason) {
      if (!active(token) || controller.signal.aborted) return;
      setBusy(false); setMessage(""); setError(failure(reason, "Your browser couldn’t read this audio file. Try an MP3, M4A, WAV, FLAC, or Ogg file."));
    }
  }
  async function selectMode(next: AudioTechnology) {
    const resumeSide = playingSide.current;
    currentMode.current = next; setMode(next);
    if (!sourceBuffer.current) return;
    const { token, controller } = begin("Preparing " + AUDIO_TECHNOLOGIES.find(value => value.id === next)!.name + "…", false);
    try {
      if (resumeSide) void context?.resume().catch(() => {});
      await prepare(sourceBuffer.current, token, controller.signal, resumeSide);
    } catch {
      if (!active(token) || controller.signal.aborted) return;
      currentComparison.current = null; setComparison(null);
      setBusy(false); setMessage(""); setError("This style couldn’t be prepared. Select it again, or try another song.");
    }
  }
  function playCurrentSong() {
    const track = music.track;
    if (!track?.audioUrl && !track?.readyPlayback) return;
    const urls = [track.readyPlayback?.fallbackUrl, track.audioUrl, track.readyPlayback?.url].filter((value): value is string => Boolean(value));
    void remote({ title: track.artists.join(", ") + " — " + track.title, url: urls[0] }, urls, Math.max(0, music.positionMs / 1000 - 5));
  }
  async function apply() {
    setSaving(true);
    try { await music.updateSettings({ audioTechnology: mode }); onClose(); }
    catch (reason) { music.reportError(reason, "save", () => void apply()); }
    finally { if (mounted.current) setSaving(false); }
  }

  useEffect(() => {
    mounted.current = true;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    const cache = comparisons.current;
    let metadataTimer: ReturnType<typeof setTimeout> | null = null;
    if (context) {
      const controller = new AbortController(); request.current = controller;
      const token = ++operation.current;
      let timedOut = false;
      metadataTimer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
      void (async () => {
        try {
          const response = await fetch("/api/v2/audio-preview", { signal: controller.signal, credentials: "same-origin" });
          if (!response.ok) throw new Error("no-example");
          const song: Example = await response.json();
          if (!active(token)) return;
          if (!song.title || !song.url) throw new Error("no-example");
          // The example endpoint may only supply an address on this Sakura host.
          const url = new URL(song.url, location.href);
          if (url.origin !== location.origin) throw new Error("no-example");
          if (metadataTimer !== null) clearTimeout(metadataTimer);
          setExample(song); await remote(song);
        } catch {
          if (active(token) && (!controller.signal.aborted || timedOut)) { setBusy(false); setMessage(""); }
        } finally { if (metadataTimer !== null) clearTimeout(metadataTimer); }
      })();
    }
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false; request.current?.abort(); stop(false);
      if (metadataTimer !== null) clearTimeout(metadataTimer);
      document.removeEventListener("visibilitychange", visibility);
      sourceBuffer.current = null; cache.clear(); currentComparison.current = null;
      // Strict Mode immediately re-runs this effect in development. Its second
      // setup cancels disposal; a real close still stops sound straight away.
      closeTimer.current = setTimeout(() => { void context?.close().catch(() => {}); }, 20);
    };
    // The dialog owns one context and one lifecycle; event handlers read mutable audio refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const duration = comparison?.duration || 0;
  const measured = comparison?.originalMetrics.loudnessLufs != null && comparison.enhancedMetrics.loudnessLufs != null;
  return <div className={s.previewBoundary} onKeyDownCapture={event => {
    if (event.code !== "Space" && event.key !== " ") return;
    // Keep the app's global transport shortcut inside this listening test.
    event.stopPropagation();
    const control = event.target instanceof Element && event.target.closest("button,input,select,textarea,a,[contenteditable=true]");
    if (!control) { event.preventDefault(); if (!event.repeat) void play(lastAudition.current); }
  }}><PlayerDialog title="Hear the difference." subtitle="A listening comparison" wide className={s.dialog} onClose={onClose} footer={<><button className={s.textButton} type="button" onClick={onClose}>Keep listening</button><button type="button" className={s.applyButton} disabled={saving || !context} onClick={() => void apply()}><PlayerIcon name="check" size={17}/>{saving ? "Saving your sound…" : "Use " + preset.name}</button></>}>
    <div className={s.intro}><p>Listen to one passage, two ways. Switch sides while it plays to catch the details.</p><span className={s.localBadge}><PlayerIcon name="volume" size={14}/>Processed on this device</span></div>
    <div className={s.sourceRow}><div className={s.songTitle}><span className={s.eyebrow}>YOUR COMPARISON SONG</span><b>{title || "Choose a comparison song"}</b><small>{comparison ? `${Math.round(duration)} second passage` : "A short passage from your song"}</small></div><div className={s.sourceActions}>
      {example && <button type="button" onClick={() => void remote(example)} disabled={!context}>Example song</button>}
      {(music.track?.audioUrl || music.track?.readyPlayback) && <button type="button" onClick={playCurrentSong} disabled={!context}>Current song</button>}
      <button type="button" onClick={() => input.current?.click()} disabled={!context}><PlayerIcon name="up" size={14}/>Choose audio file</button>
      <input ref={input} className={s.srOnly} type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.opus" aria-label="Choose a comparison audio file" onChange={event => void chooseFile(event)} disabled={!context}/>
    </div></div>
    <div className={s.compareHeading}><span className={s.eyebrow}>SAME SONG. SAME MOMENT.</span><label htmlFor={id + "-mode"}>Compare with<SelectPopover id={id + "-mode"} label="Compare with" value={mode} onChange={value => void selectMode(audioTechnology(value))} options={AUDIO_TECHNOLOGIES.map(value => ({value:value.id,label:value.name}))}/></label></div>
    <div className={s.lanes} aria-busy={busy}>
      <WaveformLane side="original" name="Original" description="None · the source sound" waveform={comparison?.originalWaveform || []} progress={duration ? position / duration : 0} playing={playing === "original"} disabled={!comparison || busy || !context} onPlay={() => void play("original")} onSeek={progress => seek(progress * duration)}/>
      <WaveformLane side="enhanced" name={preset.name} description={preset.description} waveform={comparison?.enhancedWaveform || []} progress={duration ? position / duration : 0} playing={playing === "enhanced"} disabled={!comparison || busy || !context} onPlay={() => void play("enhanced")} onSeek={progress => seek(progress * duration)}/>
      {busy && <div className={s.preparing} role="status"><SoundMark mode={mode}/><span>{message}</span></div>}
    </div>
    <div className={s.timeline}><PlaybackRibbon compact positionMs={position*1000} durationMs={duration*1000} label="Comparison position" disabled={!comparison||busy} onSeek={ms=>seek(ms/1000)}/></div>
    <div className={s.listeningOptions}><button type="button" aria-pressed={loop} onClick={() => { const side = playingSide.current; const at = cursor(); currentLoop.current = !loop; setLoop(!loop); void music.updateSettings({previewLoop:!loop}).catch(error=>music.reportError(error,"save")); if (side) launch(side, at); }}><PlayerIcon name="repeat" size={16}/>{loop ? "Loop passage" : "Play once"}</button><VolumeControl compact label="Preview volume" value={volume} onChange={value=>{currentVolume.current=value;setVolume(value);void music.updateSettings({previewVolume:value}).catch(error=>music.reportError(error,"save"));if(audible.current&&context&&currentComparison.current){const match=playingSide.current==="original"?currentComparison.current.originalGain:currentComparison.current.enhancedGain;audible.current.gain.gain.setTargetAtTime(value*match,context.currentTime,.02);}}}/></div>
    {error && <p className={s.error} role="alert">{error}</p>}
    {!comparison && !busy && !error && <p className={s.emptyHint}>Choose an audio file from this device to begin. Your file stays with you.</p>}
    {comparison && <><p className={s.comparisonNote}><PlayerIcon name="check" size={16}/>{measured ? "Listening loudness is matched, so you can compare the sound fairly." : "This passage is too quiet to measure listening loudness reliably."}</p><p className={s.modeNote}>{preset.detail}{mode === "headphones" && " Try this one with headphones."}</p><details className={s.details}><summary>Comparison details</summary><p>The same passage plays at the same position on each side. Levels are adjusted for this listening test; your source file stays unchanged.</p><table><thead><tr><th>Source measurement</th><th>Original</th><th>{preset.name}</th></tr></thead><tbody><tr><th>Listening loudness</th><td>{metric(comparison.originalMetrics.loudnessLufs, " LUFS")}</td><td>{metric(comparison.enhancedMetrics.loudnessLufs, " LUFS")}</td></tr><tr><th>Sample peak</th><td>{metric(comparison.originalMetrics.peakDbfs, " dBFS")}</td><td>{metric(comparison.enhancedMetrics.peakDbfs, " dBFS")}</td></tr></tbody></table><small>These are the measurements before preview level matching. Sound preferences depend on your song, speakers, and headphones.</small></details></>}
  </PlayerDialog></div>;
}

function metric(value: number | null, suffix: string) { return value != null && Number.isFinite(value) ? value.toFixed(1) + suffix : "Too quiet"; }

function WaveformLane({ side, name, description, waveform, progress, playing, disabled, onPlay, onSeek }: { side: Side; name: string; description: string; waveform: number[]; progress: number; playing: boolean; disabled: boolean; onPlay: () => void; onSeek: (progress: number) => void }) {
  const bars = waveform.length ? waveform : Array.from({ length: 112 }, () => 0);
  return <div className={s.lane + (playing ? " " + s.audible : "") + (side === "enhanced" ? " " + s.enhanced : "")} data-audio-side={side}>
    <div className={s.laneHeading}><div><span>{side === "original" ? "01" : "02"}</span><b>{name}</b><small>{description}</small></div><button type="button" aria-label={(playing ? "Pause " : "Play ") + (side === "original" ? "original" : name)} aria-pressed={playing} disabled={disabled} onClick={onPlay}><PlayerIcon name={playing ? "pause" : "play"} size={19}/><span>{playing ? "Pause" : "Play"}</span></button></div>
    <svg className={s.waveform} viewBox="0 0 720 76" preserveAspectRatio="none" role="img" aria-label={name + " audio waveform"} onPointerDown={event => { if (disabled) return; const rect = event.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))); }}>
      <path d="M0 38h720" stroke="currentColor" strokeWidth=".6" opacity=".15"/>
      {bars.map((value, index) => { const height = Math.max(1.4, Math.min(68, value * 68)); return <rect key={index} x={index * 720 / bars.length} y={38 - height / 2} width={Math.max(1, 720 / bars.length - 2.7)} height={height} rx="1" fill="currentColor" opacity={index / bars.length <= progress ? .9 : .35}/>; })}
      {waveform.length > 0 && <path d={`M${Math.max(0, Math.min(720, progress * 720))} 0v76`} stroke="currentColor" strokeWidth="1.4"/>}
    </svg>
  </div>;
}
