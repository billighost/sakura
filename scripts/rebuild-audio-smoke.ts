import "dotenv/config";
import { randomUUID,createHash } from "node:crypto";
import { writeFile,mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DeezerCatalogProvider, SpotifyCatalogProvider } from "../src/rebuild/server/providers";
import { DeezerCatalogService } from "../src/rebuild/server/catalog";
import { WorkerAudioDiscovery } from "../src/rebuild/server/sources";
import { SourceAudioTransport } from "../src/rebuild/server/gateway";
import { assessAudioCandidate } from "../src/rebuild/core/matching";
import type { CanonicalRecording } from "../src/rebuild/core/types";
import { getRebuildServices } from "../src/rebuild/server/runtime";
import { getRebuildPool } from "../src/rebuild/data/db";

// Explicit live check: a bot-chat request may be created, but no local second
// Telegram session is opened, and no unverified audio or private configuration is stored.
async function main() {
if (!process.argv.includes("--live")) throw new Error("Pass --live to verify the configured full-audio provider.");
const url = process.env.TELEGRAM_WORKER_URL, secret = process.env.WORKER_SECRET;
if (!url || !secret) throw new Error("Configure TELEGRAM_WORKER_URL and WORKER_SECRET before checking live audio.");
const bot = process.env.TELEGRAM_BOT_USERNAME || "musicshuntersbot";
const discovery = new WorkerAudioDiscovery({ url, secret, primaryBot: bot });
const transport = new SourceAudioTransport({ allowedCdnOrigins: [], worker: { url, secret, chatScope: bot }, headerTimeoutMs: 15000 });
const spotify=process.env.SPOTIFY_CLIENT_ID&&process.env.SPOTIFY_CLIENT_SECRET?new SpotifyCatalogProvider(process.env.SPOTIFY_CLIENT_ID,process.env.SPOTIFY_CLIENT_SECRET):undefined;
const catalog = new DeezerCatalogService(fetch,spotify), exact = new DeezerCatalogProvider();
const indexVerified=process.argv.includes("--index-verified");
const full=process.argv.includes("--full");
const results: Record<string, unknown>[] = [];
for (const expected of [
  { title: "Finesse", artists: ["Bruno Mars"], durationMs: 191000 },
  { title: "Ye", artists: ["Burna Boy"], durationMs: 235000 },
]) {
  const started = Date.now();
  try {
    const matches = await catalog.search(`${expected.title} ${expected.artists[0]}`);
    const selected = matches.tracks.find(track => assessAudioCandidate({ metadata: expected }, { candidateId: "catalog", metadata: track.metadata, audioKind: "full" }).acceptable);
    if (!selected) { results.push({ title: expected.title, status: "catalog-unavailable" }); continue; }
    const track = await (selected.reference.provider==="spotify"?spotify!.getExact(selected.reference):exact.getExact(selected.reference));
    if (!track) throw new Error("Exact catalogue entry was removed");
    const recording: CanonicalRecording = indexVerified?await getRebuildServices().ingestor.ensureCatalog(track):{ recordingId: randomUUID(), metadata: track.metadata, references: track.references };
    const source = await discovery.discover(recording, AbortSignal.timeout(65000));
    if (source.status !== "ready") { results.push({ title: expected.title, reference: selected.reference, status: source.status, reasons: source.status === "review" ? source.candidates.map(item => item.reasons) : source.reason, elapsedMs: Date.now() - started }); continue; }
    const sample = await transport.open(source.asset, "bytes=0-4095", AbortSignal.timeout(30000));
    const bytes = await sample.arrayBuffer();
    const signed = await transport.signedPlaybackUrl(source.asset);
    const head = signed ? await fetch(signed, { method: "HEAD", signal: AbortSignal.timeout(20000) }) : null;
    await head?.body?.cancel();
    let fullVerification:Record<string,unknown>|undefined;
    if(full){
      const response=await transport.open(source.asset,null,AbortSignal.timeout(90000));
      const entireFile=Buffer.from(await response.arrayBuffer());
      if(response.status!==200||entireFile.byteLength!==source.asset.sizeBytes)throw new Error("Full audio transfer was incomplete");
      await mkdir(".local/rebuild-audio-check",{recursive:true});const file=`.local/rebuild-audio-check/${expected.title.toLowerCase()}.mp3`;await writeFile(file,entireFile);
      const probe=spawnSync("ffprobe",["-v","error","-show_entries","format=duration:format_tags=title,artist","-of","json",file],{encoding:"utf8",windowsHide:true});
      if(probe.status!==0)throw new Error("Audio decoder rejected the full source file");
      const decoded=JSON.parse(probe.stdout) as {format:{duration:string;tags?:{title?:string;artist?:string}}};
      const decodedDurationMs=Math.round(Number(decoded.format.duration)*1000);
      if(Math.abs(decodedDurationMs-(track.metadata.durationMs??0))>5000)throw new Error("Decoded full audio duration differs from selected recording");
      fullVerification={bytes:entireFile.byteLength,sha256:createHash("sha256").update(entireFile).digest("hex"),decodedDurationMs,decodedTitle:decoded.format.tags?.title,decodedArtist:decoded.format.tags?.artist};
      source.asset.sha256=String(fullVerification.sha256);
    }
    if(indexVerified&&sample.status===206&&bytes.byteLength===4096&&head?.status===200)await getRebuildServices().ingestor.persistAudio(recording,source.asset);
    results.push({ title: expected.title, reference: selected.reference, status: "verified-source", protocol: source.asset.locator.kind === "telegram-worker" ? source.asset.locator.protocol : "cdn", sourceTitle: source.asset.candidate.metadata.title,
      sourceArtists: source.asset.candidate.metadata.artists, durationMs: source.asset.candidate.metadata.durationMs, sizeBytes: source.asset.sizeBytes, mimeType: source.asset.mimeType,
      rangeStatus: sample.status, rangeHeader: sample.headers.get("Content-Range"), sampleBytes: bytes.byteLength, signedHeadStatus: head?.status,indexedVerified:indexVerified,fullVerification,elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({ title: expected.title, status: "failed", errorCategory: error instanceof Error ? error.name : "unknown", elapsedMs: Date.now() - started });
  }
  console.log(JSON.stringify(results[results.length - 1]));
}
await writeFile("docs/rebuild/LIVE-AUDIO-CHECK.json", JSON.stringify({ checkedAt: new Date().toISOString(), verification: "Exact catalogue metadata, strict returned source tags and ranged full-file delivery; this does not certify an acoustic fingerprint.", results }, null, 2) + "\n");
if (results.some(result => result.status !== "verified-source" || result.rangeStatus !== 206 || result.sampleBytes !== 4096 || result.signedHeadStatus !== 200)) process.exitCode = 1;
if(indexVerified)await getRebuildPool().end();
}
void main().catch(error => { console.error(JSON.stringify({ status: "failed", errorCategory: error instanceof Error ? error.name : "unknown" })); process.exitCode = 1; });
