import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { chromium } from "@playwright/test";

// Input is a decoded, <=30-second mono/stereo WAV. Output never enters public/.
const directory = resolve(".local/audio-technology");
const input = resolve(process.argv[2] || directory + "/source.wav");
await mkdir(directory, { recursive: true });
async function browserModule(file, dependencies = {}) {
  let code = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const [name, url] of Object.entries(dependencies)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const presets = await browserModule("src/rebuild/audio/presets.ts");
const engine = await browserModule("src/rebuild/audio/engine.ts", { "./presets": presets });
const analysis = await browserModule("src/rebuild/audio/analysis.ts", { "./presets": presets });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.exposeFunction("saveAudition", async (mode, encoded) => {
    await writeFile(resolve(directory, mode + ".wav"), Buffer.from(encoded, "base64"));
    console.log("Rendered " + mode + ".wav");
  });
  const source = (await readFile(input)).toString("base64");
  const metadata = await page.evaluate(async ({ source, presets, engine, analysis }) => {
    const library = { ...await import(presets), ...await import(engine), ...await import(analysis) };
    const context = new AudioContext({ sampleRate: 48000 });
    const bytes = Uint8Array.from(atob(source), character => character.charCodeAt(0));
    const original = await context.decodeAudioData(bytes.buffer);
    if (original.duration > 30) throw new Error("Use an excerpt of 30 seconds or less.");
    const rendered = [];
    for (const preset of library.AUDIO_TECHNOLOGIES) {
      const buffer = await library.renderAudio(original, preset.id);
      rendered.push({ preset, buffer, metrics: library.analyseAudio(buffer) });
    }
    let target = Math.min(...rendered.map(item => item.metrics.loudnessLufs ?? -70));
    for (const item of rendered) if (item.metrics.peakDbfs !== null && item.metrics.loudnessLufs !== null) {
      target = Math.min(target, item.metrics.loudnessLufs - 1 - item.metrics.peakDbfs);
    }
    const modes = [];
    for (const { preset, buffer, metrics } of rendered) {
      const gain = metrics.loudnessLufs === null ? 1 : library.dbToGain(target - metrics.loudnessLufs);
      const wav = library.encodeAudioWav(buffer, gain);
      let binary = "";
      for (let from = 0; from < wav.length; from += 32768) binary += String.fromCharCode(...wav.subarray(from, from + 32768));
      await globalThis.saveAudition(preset.id, btoa(binary));
      modes.push({ id: preset.id, name: preset.name, description: preset.description, detail: preset.detail, metrics, gain, waveform: library.audioWaveform(buffer, gain) });
    }
    await context.close();
    return { title: "Ayra Starr — Commas", passage: "0:42–1:06", duration: original.duration, targetLufs: target, modes };
  }, { source, presets, engine, analysis });
  await writeFile(resolve(directory, "comparison.json"), JSON.stringify(metadata, null, 2));
  await writeFile(resolve(directory, "index.html"), await readFile("scripts/audio-technology-preview.html", "utf8"));
  console.log(JSON.stringify({ directory, seconds: metadata.duration, modes: metadata.modes.length, commonLoudnessLufs: metadata.targetLufs }));
} finally { await browser.close(); }
