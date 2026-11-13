import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
import { chromium } from "@playwright/test";

const sources = {};
async function moduleUrl(path, dependencies = {}) {
  const source = await readFile(path, "utf8");
  sources[path] = createHash("sha256").update(source).digest("hex");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const [dependency, url] of Object.entries(dependencies)) code = code.replaceAll(JSON.stringify(dependency), JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}

const presets = await moduleUrl("src/rebuild/audio/presets.ts");
const analysis = await moduleUrl("src/rebuild/audio/analysis.ts", { "./presets": presets });
const session = await moduleUrl("src/rebuild/audio/analysisSession.ts", { "./analysis": analysis });
const worker = await moduleUrl("src/rebuild/audio/analysis.worker.ts", { "./analysis": analysis });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.route("http://sakura-audio-benchmark.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Sakura audio DSP benchmark</title><button>Input fixture</button>" }));
  await page.goto("http://sakura-audio-benchmark.test/");
  const client = await page.context().newCDPSession(page);
  const measurements = [];
  for (const cpuRate of [1, 4]) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    measurements.push(await page.evaluate(async ({ analysisUrl, sessionUrl, workerUrl, cpuRate }) => {
      const { analyseAudio, audioWaveform, measuredWaveform } = await import(analysisUrl);
      const { AudioAnalysisSession } = await import(sessionUrl);
      const workerAddress = URL.createObjectURL(new Blob([`import ${JSON.stringify(workerUrl)}`], { type: "text/javascript" }));
      const data = [new Float32Array(24 * 48000).fill(.1), new Float32Array(24 * 48000).fill(.2)];
      const buffer = () => ({ numberOfChannels: 2, sampleRate: 48000, length: data[0].length, getChannelData: channel => data[channel] });
      const tasks = [];
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
      observer.observe({ type: "longtask", buffered: false });
      const rows = [];
      let ticks = 0;
      const timer = setInterval(() => ticks++, 10);
      try {
        for (const mode of ["previous-main", "worker-first", "worker-cached-original"]) {
          let workerMessages = 0;
          const analyzer = new AudioAnalysisSession(() => { const worker = new Worker(workerAddress, { type: "module" }); worker.addEventListener("message", () => workerMessages++); return worker; });
          const original = buffer();
          if (mode === "worker-cached-original") await analyzer.measure(original);
          try {
            for (let sample = 0; sample < 3; sample++) {
              // Fresh identities measure work, rather than repeated cache hits.
              const source = mode === "worker-cached-original" ? original : buffer(), enhanced = buffer();
              await new Promise(resolve => setTimeout(resolve, 0));
              const beforeTicks = ticks, started = performance.now();
              if (mode === "previous-main") {
                analyseAudio(source); analyseAudio(enhanced); audioWaveform(source); audioWaveform(enhanced);
              } else {
                const one = await analyzer.measure(source), two = await analyzer.measure(enhanced);
                measuredWaveform(one.peaks, 1); measuredWaveform(two.peaks, 1);
              }
              const finished = performance.now(), inputTicks = ticks - beforeTicks;
              await new Promise(resolve => setTimeout(resolve, 0));
              const longTasks = tasks.filter(task => task.start + task.duration > started && task.start < finished);
              rows.push({ mode, sample, elapsedMs: +(finished - started).toFixed(2), inputTicks,
                workerMessages, fallback: analyzer.unsupported,
                longTaskCount: longTasks.length, maxMainTaskMs: +Math.max(0, ...longTasks.map(task => task.duration)).toFixed(2) });
            }
          } finally { analyzer.dispose(); }
        }
        return { cpuRate, sampleRate: 48000, channels: 2, seconds: 24, rows };
      } finally { clearInterval(timer); observer.disconnect(); URL.revokeObjectURL(workerAddress); }
    }, { analysisUrl: analysis, sessionUrl: session, workerUrl: worker, cpuRate }));
  }
  const report = { measuredAt: new Date().toISOString(), browser: await browser.version(), sources, measurements,
    scope: "Isolated Chromium generated PCM. Previous-main uses the unchanged former sample loops; worker modes use current dispatch/cache. Excludes native decoding, rendering, HTTP and physical audio. Shared-host timings are not production percentiles." };
  await mkdir(".local", { recursive: true });
  await writeFile(".local/rebuild-audio-dsp-performance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ browser: report.browser, measurements }, null, 2));
} finally { await browser.close(); }
