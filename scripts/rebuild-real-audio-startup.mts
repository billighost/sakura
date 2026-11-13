/** Real provider bytes, read-only canonical assets and explicit full-file verification. */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getRebuildPool } from "../src/rebuild/data/db";
import { PostgresRecordingRepository, type ReadonlySql } from "../src/rebuild/server/repository";
import { SourceAudioTransport } from "../src/rebuild/server/gateway";
import { inspectFullAudio } from "../src/rebuild/server/audio-inspection";
import type { StoredAudioAsset } from "../src/rebuild/server/contracts";

const targets = [
  { key: "finesse", provider: "deezer" as const, id: "136336124" },
  { key: "inertia", provider: "deezer" as const, id: "3284976751" },
  { key: "ye", provider: "spotify" as const, id: "2lEl1iNGpz9r2B7R5BqXSD" },
];
const directory = resolve(".local/real-audio-startup");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface TransferSample {
  range: string; status?: number; contentRange?: string | null; headersMs?: number;
  firstByteMs?: number; elapsedMs: number; bytes: number; sha256?: string;
  prefixDecodedBytes?: number; decodedPeak?: number; errorCategory?: string; reason?: string;
}
async function transfer(transport: SourceAudioTransport, asset: StoredAudioAsset, range: string) {
  const started = performance.now();
  const sample: TransferSample = { range, bytes: 0, elapsedMs: 0 };
  const parts: Buffer[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await transport.open(asset, range, controller.signal);
    sample.headersMs = Math.round(performance.now() - started);
    sample.status = response.status;
    sample.contentRange = response.headers.get("Content-Range");
    assert.equal(response.status, 206, "The real provider must serve the exact requested range");
    const requested = /^bytes=(\d+)-(\d*)$/.exec(range);
    assert.ok(requested);
    const start = Number(requested[1]), end = requested[2] ? Number(requested[2]) : asset.sizeBytes - 1;
    assert.equal(sample.contentRange, `bytes ${start}-${end}/${asset.sizeBytes}`, "The real provider must preserve the exact byte offsets");
    assert.equal(Number(response.headers.get("Content-Length")), end - start + 1, "The real provider must preserve the exact range length");
    assert.ok(response.body);
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sample.firstByteMs ??= Math.round(performance.now() - started);
        sample.bytes += value.byteLength;
        assert.ok(sample.bytes <= asset.sizeBytes, "Provider must not exceed the complete asset");
        parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(parts);
    sample.sha256 = sha256(bytes);
    const decoded = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-i", "pipe:0", "-t", "1", "-f", "f32le", "pipe:1"], {
      input: bytes, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    sample.prefixDecodedBytes = decoded.stdout?.byteLength ?? 0;
    if (decoded.stdout?.byteLength) {
      let peak = 0;
      for (let offset = 0; offset + 4 <= decoded.stdout.byteLength; offset += 4)
        peak = Math.max(peak, Math.abs(decoded.stdout.readFloatLE(offset)));
      sample.decodedPeak = Number(peak.toFixed(6));
    }
    return { sample, bytes };
  } catch (error) {
    sample.errorCategory = error instanceof Error ? error.name : "unknown";
    if (error instanceof Error && /^(?:Worker (?:audio|chat|document|origin|message)|The real provider|The historical public|An already verified|Provider must)/.test(error.message)) sample.reason = error.message;
    return { sample, bytes: undefined };
  } finally { clearTimeout(timer); controller.abort(); sample.elapsedMs = Math.round(performance.now() - started); }
}

async function main() {
  assert.ok(process.argv.includes("--live"), "Pass --live to download actual public ready song files");
  await mkdir(directory, { recursive: true });
  const pool = getRebuildPool();
  const query: ReadonlySql = async <Row,>(statement: string, parameters: readonly unknown[]) =>
    (await pool.query(statement, [...parameters])).rows as Row[];
  const repository = new PostgresRecordingRepository(query);
  // A nonexistent account can read only public assets; no user session or account mutation is needed.
  const accountId = "90000000-0000-4000-8000-000000000096";
  const worker = process.env.TELEGRAM_WORKER_URL && process.env.WORKER_SECRET ? {
    url: process.env.TELEGRAM_WORKER_URL, secret: process.env.WORKER_SECRET,
    chatScope: process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot",
    allowedChatScopes: (process.env.TELEGRAM_FALLBACK_BOTS || "").split(",").filter(Boolean),
  } : undefined;
  const transport = new SourceAudioTransport({ allowedCdnOrigins: ["https://res.cloudinary.com"], worker, headerTimeoutMs: 20000 });
  const report: { checkedAt: string; scope: string; results: Record<string, unknown>[] } = {
    checkedAt: new Date().toISOString(),
    scope: "Read-only public canonical assets; real provider range/full transfers, checksum verification and FFmpeg decoding. No catalog, bot-search, account, collection or deployment writes. Browser startup is verified separately with these exact downloaded files.",
    results: [],
  };
  try {
    for (const target of targets) {
      const recording = await repository.findByReference({ provider: target.provider, id: target.id });
      assert.ok(recording, "The historical public test recording must already exist");
      const available = (await repository.listAudio(recording.recordingId, accountId)).filter(asset =>
        asset.ownerAccountId === null && asset.sha256 && asset.sizeBytes < 16 * 1024 * 1024);
      console.log(JSON.stringify({ key: target.key, available: available.map(item => ({ assetId: item.assetId, kind: item.locator.kind, protocol: item.locator.kind === "telegram-worker" ? item.locator.protocol : "cdn" })) }));
      const asset = process.argv.includes("--worker") ? available.find(item => item.locator.kind === "telegram-worker" && item.locator.protocol === "v2")
        ?? available.find(item => item.locator.kind === "telegram-worker") : available.find(item => item.locator.kind === "https") ?? available[0];
      assert.ok(asset, "An already verified public full asset is required");
      const file = resolve(directory, target.key + ".mp3");
      const row: Record<string, unknown> = {
        key: target.key, recordingId: recording.recordingId, assetId: asset.assetId,
        title: recording.metadata.title, artists: recording.metadata.artists,
        sizeBytes: asset.sizeBytes, expectedSha256: asset.sha256, mimeType: asset.mimeType,
        transport: asset.locator.kind === "telegram-worker" ? asset.locator.protocol : "cdn", samples: [],
        ...(asset.locator.kind === "https" ? { publicSourceUrl: asset.locator.url } : {}),
      };
      report.results.push(row);
      const samples = row.samples as TransferSample[];
      for (const length of process.argv.includes("--audio-opening-only") ? [] : [32 * 1024, 64 * 1024]) {
        const result = await transfer(transport, asset, `bytes=0-${length - 1}`);
        samples.push(result.sample);
        console.log(JSON.stringify({ key: target.key, ...result.sample }));
        if (result.bytes) {
          assert.equal(result.bytes.length, length);
          await writeFile(resolve(directory, target.key + "-" + length + ".prefix"), result.bytes);
        }
      }
      let bytes: Buffer | undefined;
      try { const saved = await readFile(file); if (saved.length === asset.sizeBytes && sha256(saved) === asset.sha256) bytes = saved; } catch { /* First explicit download. */ }
      row.reusedVerifiedFile = !!bytes;
      if (!bytes) {
        const result = await transfer(transport, asset, "bytes=0-");
        samples.push(result.sample); bytes = result.bytes;
        console.log(JSON.stringify({ key: target.key, full: true, ...result.sample }));
      }
      if (bytes) {
        assert.equal(bytes.length, asset.sizeBytes, "The full download must contain every expected byte");
        assert.equal(sha256(bytes), asset.sha256, "The downloaded file must match the canonical checksum");
        row.measured = await inspectFullAudio(bytes, recording, asset);
        await writeFile(file, bytes);
        const decoded = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { windowsHide: true });
        assert.equal(decoded.status, 0, "The complete real song must decode without errors");
        const tagEnd = bytes.subarray(0, 3).toString() === "ID3" ? 10 + (bytes[6] & 127) * 2097152
          + (bytes[7] & 127) * 16384 + (bytes[8] & 127) * 128 + (bytes[9] & 127) : 0;
        row.leadingTagBytes = tagEnd;
        if (tagEnd > 0) {
          const opening = await transfer(transport, asset, `bytes=${tagEnd}-${tagEnd + 32768 - 1}`);
          samples.push(opening.sample);
          if (opening.bytes) assert.deepEqual(opening.bytes, bytes.subarray(tagEnd, tagEnd + 32768), "The real sparse range must exactly match the verified complete song");
          row.sparseAudioVerified = !!opening.bytes && (opening.sample.prefixDecodedBytes ?? 0) > 0;
          if (!row.sparseAudioVerified) process.exitCode = 1;
          console.log(JSON.stringify({ key: target.key, audioOpening: true, ...opening.sample }));
        }
        row.file = ".local/real-audio-startup/" + target.key + ".mp3";
        row.fullVerified = true;
      } else { row.fullVerified = false; process.exitCode = 1; }
      await writeFile(resolve(directory, "transport-report.json"), JSON.stringify(report, null, 2) + "\n");
    }
  } finally { await pool.end(); }
  console.log(JSON.stringify({ results: report.results.length, report: ".local/real-audio-startup/transport-report.json" }));
}
void main().catch(error => {
  console.error(JSON.stringify({ status: "failed", errorCategory: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
