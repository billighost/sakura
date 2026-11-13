import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import type { CanonicalRecording } from "../src/rebuild/core/types";
import type { StoredAudioAsset } from "../src/rebuild/server/contracts";

/** Generated valid PCM-WAV byte streams and mocked Cloudinary only. Each sample
 * runs in a separate process; no secrets, real provider calls or files are used. */
async function main() {
const scriptPath = path.resolve(process.argv[1]);
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=")));
if (!Object.hasOwn(options, "child")) {
  const sizes = (options.sizes ?? "5,30,120").split(",").map(Number);
  for (const size of sizes) for (const mode of ["baseline", "current"]) {
    const output = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", scriptPath, "--child", `--mode=${mode}`, `--mib=${size}`, "--jobs=2"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    process.stdout.write(output);
  }
} else {
  const mode = options.mode, bytes = Number(options.mib) * 1024 * 1024, count = Number(options.jobs);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 120 * 1024 * 1024 || ![1, 2].includes(count)) throw new Error("Invalid bounded fixture");
  let implementation: typeof import("../src/rebuild/server/promotion");
  if (mode === "baseline") {
    const source = execFileSync("git", ["show", "5229fdb:src/rebuild/server/promotion.ts"], { encoding: "utf8" });
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function("require", "module", "exports", compiled)(createRequire(path.resolve(path.dirname(scriptPath), "../src/rebuild/server/promotion.ts")), { exports }, exports);
    implementation = exports as typeof implementation;
  } else implementation = await import("../src/rebuild/server/promotion");
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  const baseline = process.memoryUsage(), peak = { ...baseline };
  const sample = () => { const current = process.memoryUsage(); for (const field of ["rss", "heapUsed", "external", "arrayBuffers"] as const) peak[field] = Math.max(peak[field], current[field]); };
  const durationMs = Math.round((bytes - 44) / (48000 * 4) * 1000);
  const stream = () => {
    let position = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (position === bytes) { controller.close(); return; }
      const chunk = Buffer.alloc(Math.min(256 * 1024, bytes - position), 23);
      if (position === 0) {
        chunk.write("RIFF"); chunk.writeUInt32LE(bytes - 8, 4); chunk.write("WAVEfmt ", 8); chunk.writeUInt32LE(16, 16);
        chunk.writeUInt16LE(1, 20); chunk.writeUInt16LE(2, 22); chunk.writeUInt32LE(48000, 24); chunk.writeUInt32LE(48000 * 4, 28);
        chunk.writeUInt16LE(4, 32); chunk.writeUInt16LE(16, 34); chunk.write("data", 36); chunk.writeUInt32LE(bytes - 44, 40);
      }
      position += chunk.length; controller.enqueue(chunk); sample();
    } }), { headers: { "Content-Type": "audio/wav" } });
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const recordingId = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
    const recording: CanonicalRecording = { recordingId, references: [{ provider: "deezer", id: String(index + 1) }], metadata: { title: "Generated WAV", artists: ["Fixture artist"], durationMs } };
    const assembled = await implementation.completeAudio(stream(), bytes); sample();
    const sha256 = createHash("sha256").update(assembled).digest("hex"), publicId = `sakura/v2/audio/${recordingId}/${sha256}`;
    const source: StoredAudioAsset = { assetId: recordingId, recordingId, candidate: { candidateId: recordingId, audioKind: "full", metadata: recording.metadata, references: recording.references }, locator: { kind: "telegram-worker", chatScope: "fixturebot", messageId: String(index + 1) }, state: "ready", verifiedAt: new Date().toISOString(), mimeType: "audio/wav", sizeBytes: bytes, sha256, ownerAccountId: null };
    const publisher = new implementation.CloudinaryAudioPublisher({ cloudName: "fixture", apiKey: "fixture-only", apiSecret: "fixture-only" }, async (url, init) => {
      sample();
      if (String(url).endsWith("/usage")) return Response.json({ credits: { usage: 1, limit: 25 } });
      if (String(url).includes("/resources/video/upload/")) return Response.json({}, { status: 404 });
      if (String(url).endsWith("/video/upload")) {
        const file = (init?.body as FormData).get("file") as Blob;
        if (file.size !== bytes) throw new Error("Upload changed fixture bytes");
        sample(); return Response.json({ public_id: publicId, bytes, version: 1, format: "wav", secure_url: `https://res.cloudinary.com/fixture/video/upload/v1/${publicId}.wav` });
      }
      return stream();
    });
    const result = await publisher.publish(recording, source, assembled); sample();
    if (result.sha256 !== sha256 || result.sizeBytes !== bytes || result.locator.kind !== "https") throw new Error("Fixture identity changed");
  }));
  const mib = (value: number) => Number((value / (1024 * 1024)).toFixed(2));
  console.log(JSON.stringify({ fixture: "generated PCM-WAV assembly/upload/full-CDN verification; mocked provider", mode, mib: Number(options.mib), simultaneousJobs: count, elapsedMs: Number((performance.now() - started).toFixed(2)), peakIncreaseMiB: Object.fromEntries((["rss", "heapUsed", "external", "arrayBuffers"] as const).map(field => [field, mib(peak[field] - baseline[field])])) }));
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
