import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceKey } from "../core/identity";
import { assessAudioCandidate } from "../core/matching";
import type { CanonicalRecording, ProviderReference } from "../core/types";
import { parseResolveInput, readResolveInput,parseRecordingMetadata,parseTrustedRecordingMetadata } from "./input";
import { CachedCatalogProvider, DeezerCatalogProvider, SpotifyCatalogProvider } from "./providers";
import { RecordingResolver } from "./resolver";
import { RecordingAudioGateway, SourceAudioTransport, type AudioTransport } from "./gateway";
import { PostgresRecordingRepository, UNINITIALIZED_REPOSITORY, type ReadonlySql } from "./repository";
import type { CatalogProvider, CatalogRecording, RecordingRepository, StoredAudioAsset } from "./contracts";
import { WorkerAudioDiscovery } from "./sources";
import { RecordingIngestor,RecordingIdentityConflict,type SqlTransaction } from "./ingestion";
import { AudioResolutionJobs } from "./jobs";
import { MusicCollectionImporter,collectionUrl,youtubeInitialData } from "./import";
import { catalogTrack, DeezerCatalogService } from "./catalog";
import { PlaybackTargets } from "./targets";
import { AudioPromotions, CloudinaryAudioPublisher, completeAudio, AudioPromotionError } from "./promotion";
import { ProductionRecordingResolver } from "./production-resolver";
import { CatalogMetadataAliases,withVerifiedCatalogAliases } from "./metadata-aliases";
import { CatalogArtistAliases } from "./artist-aliases";
import {createHash,createHmac} from "node:crypto";
import {waveAudio} from "../../../scripts/fixtures/audio";

const recordingId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const reference: ProviderReference = { provider: "deezer", id: "123" };
const isrc: ProviderReference = { provider: "isrc", id: "USAT21602949" };
const canonical: CanonicalRecording = { recordingId, metadata: { title: "Finesse", artists: ["Bruno Mars"], durationMs: 191000 }, references: [reference, isrc] };
const catalog: CatalogRecording = { metadata: canonical.metadata, reference, references: [reference, isrc] };
const source: StoredAudioAsset = { assetId, recordingId, candidate: { candidateId: assetId, metadata: canonical.metadata, references: [isrc], audioKind: "full" }, locator: { kind: "https", url: "https://cdn.example.test/audio.mp3" }, state: "ready", verifiedAt: "2026-11-07T00:00:00Z", mimeType: "audio/mpeg", sizeBytes: 10, ownerAccountId: null };

class MemoryRepository implements RecordingRepository {
  readonly initialized = true;
  aliases = new Map<string, CanonicalRecording>();
  records: CanonicalRecording[] = [canonical];
  assets: StoredAudioAsset[] = [source];
  constructor(indexed = true) { if (indexed) canonical.references?.forEach((ref) => this.aliases.set(referenceKey(ref), canonical)); }
  async findByReference(ref: ProviderReference) { return this.aliases.get(referenceKey(ref)) ?? null; }
  async findById(id: string) { return this.records.find((item) => item.recordingId === id) ?? null; }
  async listAudio(id: string) { return this.assets.filter((item) => item.recordingId === id); }
  async findAudio(id: string, asset: string) { return this.assets.find((item) => item.recordingId === id && item.assetId === asset) ?? null; }
}
class MockCatalog implements CatalogProvider {
  readonly provider = "deezer" as const;
  calls = 0;
  constructor(private readonly value: CatalogRecording | null = catalog) {}
  async getExact() { this.calls++; return this.value ? structuredClone(this.value) : null; }
}
function audioResponse(range: string | null): Response {
  if (!range) return new Response("0123456789", { headers: { "Content-Type": "audio/mpeg", "Content-Length": "10" } });
  const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
  return new Response("0123456789".slice(Number(start), Number(end) + 1), { status: 206, headers: { "Content-Type": "audio/mpeg", "Content-Length": String(Number(end) - Number(start) + 1), "Content-Range": `bytes ${start}-${end}/10` } });
}
function gateway(repository = new MemoryRepository(), open?: AudioTransport["open"]) {
  return new RecordingAudioGateway(repository, { open: open ?? (async (_asset, range) => audioResponse(range)) });
}
const gatewayInput = { recordingId, assetId, accountId };

test("public resolver accepts exact catalogue IDs and rejects URL/placeholder/provider injection", () => {
  assert.deepEqual(parseResolveInput({ reference }), { reference });
  assert.throws(() => parseResolveInput({ reference: { provider: "deezer", id: "123/other" } }));
  assert.throws(() => parseResolveInput({ reference: { provider: "telegram", id: "1", scope: "bot" } }));
  assert.throws(() => parseResolveInput({ reference, expected: { title: "Finesse", artists: [], durationMs: 191 } }));
  assert.equal(parseResolveInput({reference,expected:{...canonical.metadata,artistsComplete:false}}).expected?.artistsComplete,false);
  assert.throws(() => parseResolveInput({reference,expected:{...canonical.metadata,artistsComplete:"false"}}));
});

test("request parser handles malformed JSON, bounded bodies and millisecond metadata", async () => {
  const input = await readResolveInput(new Request("https://app.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference, expected: canonical.metadata }) }));
  assert.equal(input.expected?.durationMs, 191000);
  await assert.rejects(readResolveInput(new Request("https://app.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), /valid JSON/);
  await assert.rejects(readResolveInput(new Request("https://app.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(33000) })), /32KB/);
});

test("Deezer adapter requests exact ID and never fetches search or treats preview as full audio", async () => {
  const calls: string[] = [];
  const provider = new DeezerCatalogProvider((async (url) => {
    calls.push(String(url));
    return Response.json({ id: 123, title: "Finesse", duration: 191, isrc: "USAT21602949", preview: "https://preview.test/finesse.mp3", artist: { name: "Bruno Mars" }, album: { title: "24K Magic" } });
  }) as typeof fetch);
  const value = await provider.getExact(reference);
  assert.deepEqual(calls, ["https://api.deezer.com/track/123"]);
  assert.equal(value?.metadata.durationMs, 191000);
  assert.ok(value?.references.some((ref) => ref.provider === "isrc"));
  assert.ok(!JSON.stringify(value).includes("preview.test"));
});

test("Deezer's separate title_version and featured performers survive normalization", async () => {
  const provider = new DeezerCatalogProvider((async () => Response.json({ id: 123, title: "Finesse", title_version: "Remix", duration: 217, artist: { id:789,name: "Bruno Mars" }, contributors: [{ id:789,name: "Bruno Mars", role: "Main" }, { id:987,name: "Cardi B", role: "Featured" }] })) as typeof fetch);
  const value = await provider.getExact(reference);
  assert.deepEqual(value?.metadata.version?.kinds, ["remix"]);
  assert.deepEqual(value?.metadata.artists, ["Bruno Mars", "Cardi B"]);
  assert.equal(value?.metadata.artistsComplete,true);
  assert.deepEqual(value?.artistCredits,[{name:"Bruno Mars",role:"primary",reference:{provider:"deezer",id:"789"}},{name:"Cardi B",role:"featured",reference:{provider:"deezer",id:"987"}}]);
});

test("search summaries mark absent contributors incomplete and retain exact known artist references",()=>{
 const summary=catalogTrack({id:123,title:"INERTIA",duration:199,artist:{id:789,name:"SawanoHiroyuki[nZk]"}});
 assert.equal(summary?.metadata.artistsComplete,false);
 assert.deepEqual(summary?.artistCredits,[{name:"SawanoHiroyuki[nZk]",role:"primary",reference:{provider:"deezer",id:"789"}}]);
 const exact=catalogTrack({id:123,title:"INERTIA",duration:199,artist:{id:789,name:"SawanoHiroyuki[nZk]"},contributors:[{id:789,name:"SawanoHiroyuki[nZk]",role:"Main"},{id:987,name:"Rei",role:"Featured"}]});
 assert.equal(exact?.metadata.artistsComplete,true);assert.equal(exact?.artistCredits?.length,2);
});

test("catalogue wrong ID and invalid metadata cannot become recording evidence", async () => {
  const wrong = new DeezerCatalogProvider((async () => Response.json({ id: 456, title: "Wrong", artist: { name: "Other" }, duration: 200 })) as typeof fetch);
  await assert.rejects(wrong.getExact(reference), /does not match/);
  const invalid = new DeezerCatalogProvider((async () => Response.json({ id: 123, title: "Finesse", artist: {}, duration: 191 })) as typeof fetch);
  await assert.rejects(invalid.getExact(reference), /omitted recording identity/);
});

test("Spotify exact lookup keeps ID, ISRC and millisecond duration with server-only credentials", async () => {
  const spotifyId = "0123456789ABCDEFGHIJKL";
  const calls: string[] = [];
  const provider = new SpotifyCatalogProvider("client", "private-secret", (async (url) => {
    calls.push(String(url));
    if (String(url).includes("/api/token")) return Response.json({ access_token: "server-token", expires_in: 3600 });
    return Response.json({ id: spotifyId, name: "Finesse", duration_ms: 191000, artists: [{ name: "Bruno Mars" }], external_ids: { isrc: "USAT21602949" }, album: { name: "24K Magic", images: [{ url: "https://images.test/cover.jpg" }] } });
  }) as typeof fetch);
  const value = await provider.getExact({ provider: "spotify", id: spotifyId });
  assert.ok(calls[1].endsWith(`/v1/tracks/${spotifyId}`));
  assert.equal(value?.metadata.durationMs, 191000);
  assert.ok(!JSON.stringify(value).includes("private-secret"));
  assert.ok(!JSON.stringify(value).includes("server-token"));
});

test("public metadata cache avoids refetch and prevents consumer mutation poisoning", async () => {
  const upstream = new MockCatalog();
  const cache = new CachedCatalogProvider(upstream);
  const first = await cache.getExact(reference);
  first!.metadata.title = "poisoned";
  const second = await cache.getExact(reference);
  assert.equal(upstream.calls, 1);
  assert.equal(second?.metadata.title, "Finesse");
});

test("already indexed recordings resolve immediately from ready audio without provider work", async () => {
  const provider = new MockCatalog();
  const result = await new RecordingResolver(new MemoryRepository(), [provider]).resolve({ reference }, accountId);
  assert.equal(result.status, "resolved");
  assert.equal(provider.calls, 0);
  if (result.status === "resolved") assert.ok(result.playback.url.startsWith(`/api/v2/recordings/${recordingId}/audio`));
});

test("ready CDN assets can bypass the server byte proxy", async () => {
  const transport = new SourceAudioTransport({ allowedCdnOrigins: ["https://cdn.example.test"] });
  const result = await new RecordingResolver(new MemoryRepository(), [], (asset) => transport.directPlaybackUrl(asset)).resolve({ reference }, accountId);
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.playback.url, "https://cdn.example.test/audio.mp3");
    assert.equal(result.playback.fallbackUrl,`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`);
  }
});

test("new release IDs resolve through an existing verified ISRC without metadata duplicates", async () => {
  const repo = new MemoryRepository(false);
  repo.aliases.set(referenceKey(isrc), canonical);
  const newer: ProviderReference = { provider: "deezer", id: "456" };
  const provider = new MockCatalog({ ...catalog, reference: newer, references: [newer, isrc] });
  const result = await new RecordingResolver(repo, [provider]).resolve({ reference: newer }, accountId);
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") assert.equal(result.recording.recordingId, recordingId);
  assert.equal(repo.aliases.size, 1, "resolution makes no persistent alias writes");
});

test("uninitialized or unindexed backend reports truthful unavailable and never downloads", async () => {
  const uninitialized = await new RecordingResolver(UNINITIALIZED_REPOSITORY, [new MockCatalog()]).resolve({ reference }, accountId);
  assert.equal(uninitialized.status, "unavailable");
  if (uninitialized.status === "unavailable") assert.equal(uninitialized.reason, "backend-not-initialized");
  const unindexed = await new RecordingResolver(new MemoryRepository(false), [new MockCatalog()]).resolve({ reference }, accountId);
  assert.equal(unindexed.status, "unavailable");
  if (unindexed.status === "unavailable") assert.equal(unindexed.reason, "recording-not-indexed");
});

test("Finesse's catalogue mismatch and remix asset both require review", async () => {
  const remixMetadata = { title: "Finesse (Remix)", artists: ["Bruno Mars", "Cardi B"], durationMs: 217000 };
  const result = await new RecordingResolver(new MemoryRepository(false), [new MockCatalog({ ...catalog, metadata: remixMetadata })]).resolve({ reference, expected: canonical.metadata }, accountId);
  assert.equal(result.status, "review");
  if (result.status === "review") assert.equal(result.reason, "catalog-mismatch");
  const repo = new MemoryRepository();
  repo.assets = [{ ...source, candidate: { ...source.candidate, metadata: remixMetadata } }];
  const wrongAudio = await new RecordingResolver(repo, []).resolve({ reference }, accountId);
  assert.equal(wrongAudio.status, "review");
  if (wrongAudio.status === "review") assert.equal(wrongAudio.reason, "asset-mismatch");
});

test("private assets never resolve for another account even if an adapter returns them", async () => {
  const repo = new MemoryRepository();
  repo.assets = [{ ...source, ownerAccountId: otherId }];
  const result = await new RecordingResolver(repo, []).resolve({ reference }, accountId);
  assert.equal(result.status, "unavailable");
  const response = await gateway(repo).serve(gatewayInput);
  assert.equal(response.status, 404);
});

test("audio gateway streams rangeless 200 with real MIME and private caching", async () => {
  const response = await gateway().serve(gatewayInput);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(response.headers.get("Content-Length"), null);
  assert.ok(response.headers.get("Cache-Control")?.startsWith("private"));
  assert.equal(await response.text(), "0123456789");
});

test("gateway caller cancellation stops a stalled source body after response headers",async()=>{
 const caller=new AbortController();let canceled=false;
 const response=await gateway(new MemoryRepository(),async()=>new Response(new ReadableStream({start(){},cancel(){canceled=true;}}),{headers:{"Content-Type":"audio/mpeg","Content-Length":"10"}})).serve({...gatewayInput,signal:caller.signal});
 assert.equal(response.status,200);caller.abort(new DOMException("Canceled","AbortError"));
 await assert.rejects(response.text(),(error:unknown)=>error instanceof Error&&error.name==="AbortError");assert.equal(canceled,true);
});

test("marked CDN gateway uses only the verified byte-identical original source and preserves ranges",async()=>{
 const sha256=createHash("sha256").update("0123456789").digest("hex"),repo=new MemoryRepository();
 const original={...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const cdn={...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256" as const,provider:"cloudinary" as const,sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}};repo.assets=[cdn,original];
 const opened:string[]=[];const serve=gateway(repo,async(asset,range)=>{opened.push(asset.assetId);return audioResponse(range);});
 const response=await serve.serve({...gatewayInput,range:"bytes=-3"});assert.equal(response.status,206);assert.equal(response.headers.get("Content-Range"),"bytes 7-9/10");assert.equal(response.headers.get("X-Sakura-Audio-Delivery"),"verified-source-fallback");assert.equal(await response.text(),"789");assert.deepEqual(opened,[otherId]);
});

test("CDN source fallback refuses wrong SHA, metadata, owner, size and missing proof",async()=>{
 const sha256="a".repeat(64),cdn={...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256" as const,provider:"cloudinary" as const,sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}};
 const original={...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 for(const [published,worker]of [
  [{...cdn,deliveryEvidence:undefined},original],
  [{...cdn,deliveryEvidence:{...cdn.deliveryEvidence,verifiedSha256:"b".repeat(64)}},original],
  [cdn,{...original,sha256:"b".repeat(64)}],
  [cdn,{...original,ownerAccountId:accountId}],
  [cdn,{...original,sizeBytes:11}],
  [cdn,{...original,verifiedAt:"invalid"}],
  [cdn,{...original,candidate:{...original.candidate,metadata:{...canonical.metadata,title:"Finesse (Remix)"}}}],
  [cdn,{...original,candidate:{...original.candidate,audioKind:"preview" as const}}],
 ]as [StoredAudioAsset,StoredAudioAsset][]){
  const repo=new MemoryRepository();repo.assets=[published,worker];const opened:string[]=[];
  const response=await gateway(repo,async(asset,range)=>{opened.push(asset.assetId);return audioResponse(range);}).serve(gatewayInput);
  assert.equal(response.status,200);assert.equal(await response.text(),"0123456789");assert.deepEqual(opened,[assetId]);assert.equal(response.headers.get("X-Sakura-Audio-Delivery"),"primary");
 }
});

test("an unavailable verified original does not prevent delivery from the unchanged CDN artifact",async()=>{
 const sha256="a".repeat(64),repo=new MemoryRepository(),cdn={...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256" as const,provider:"cloudinary" as const,sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}};
 repo.assets=[cdn,{...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary"}}];const opened:string[]=[];
 const response=await gateway(repo,async(asset,range)=>{opened.push(asset.assetId);if(asset.assetId===otherId)throw new Error("Source temporarily unavailable");return audioResponse(range);}).serve(gatewayInput);
 assert.equal(response.status,200);assert.equal(await response.text(),"0123456789");assert.deepEqual(opened,[otherId,assetId]);assert.equal(response.headers.get("X-Sakura-Audio-Delivery"),"primary");
});

test("invalid verified-original response headers retry the unchanged CDN before any bytes escape",async()=>{
 const sha256=createHash("sha256").update("0123456789").digest("hex"),repo=new MemoryRepository();
 repo.assets=[{...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256",provider:"cloudinary",sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}},
  {...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary"}}];
 for(const [range,status,headers]of [
  ["bytes=2-4",200,{"Content-Type":"audio/mpeg","Content-Length":"10"}],
  ["bytes=2-4",412,{"Content-Type":"audio/mpeg"}],
  [null,503,{"Content-Type":"text/html"}],
  ["bytes=2-4",206,{"Content-Type":"audio/mpeg","Content-Range":"bytes 3-5/10","Content-Length":"3"}],
  ["bytes=2-4",206,{"Content-Type":"audio/mpeg","Content-Range":"bytes 2-4/10","Content-Length":"4"}],
  ["bytes=2-4",206,{"Content-Type":"text/html","Content-Range":"bytes 2-4/10","Content-Length":"3"}],
 ]as [string|null,number,Record<string,string>][]){
  const opened:[string,string|null][]= [];let canceled=false;
  const response=await gateway(repo,async(asset,requested)=>{opened.push([asset.assetId,requested]);return asset.assetId===otherId?new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("wrong"));},cancel(){canceled=true;}}),{status,headers}):audioResponse(requested);}).serve({...gatewayInput,range});
  assert.equal(response.status,range?206:200);assert.equal(await response.text(),range?"234":"0123456789");assert.equal(canceled,true);
  assert.deepEqual(opened,[[otherId,range],[assetId,range]]);assert.equal(response.headers.get("X-Sakura-Audio-Delivery"),"primary");
 }
});

test("a canceled late original response is closed without opening the verified CDN",async()=>{
 const sha256=createHash("sha256").update("0123456789").digest("hex"),repo=new MemoryRepository(),caller=new AbortController();
 repo.assets=[{...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256",provider:"cloudinary",sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}},
  {...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary"}}];
 const opened:string[]=[];let canceled=false;
 await assert.rejects(gateway(repo,async asset=>{opened.push(asset.assetId);caller.abort(new DOMException("Canceled","AbortError"));return new Response(new ReadableStream({cancel(){canceled=true;}}),{status:503});}).serve({...gatewayInput,signal:caller.signal}),error=>error instanceof Error&&error.name==="AbortError");
 assert.equal(canceled,true);assert.deepEqual(opened,[otherId]);
});

test("verified CDN retry rejects invalid CDN headers and never mixes a started original body",async()=>{
 const sha256=createHash("sha256").update("0123456789").digest("hex"),repo=new MemoryRepository();
 repo.assets=[{...source,sha256,deliveryEvidence:{method:"immutable-cdn-sha256",provider:"cloudinary",sourceAssetId:otherId,verifiedSha256:sha256,verifiedAt:source.verifiedAt}},
  {...source,assetId:otherId,sha256,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary"}}];
 const opened:string[]=[];let canceled=0;
 const invalid=await gateway(repo,async asset=>{opened.push(asset.assetId);return new Response(new ReadableStream({cancel(){canceled++;}}),{status:503,headers:{"Content-Type":"text/html"}});}).serve({...gatewayInput,range:"bytes=2-4"});
 assert.equal(invalid.status,502);assert.deepEqual(opened,[otherId,assetId]);assert.equal(canceled,2);
 opened.length=0;
 const truncated=await gateway(repo,async asset=>{opened.push(asset.assetId);return new Response("2",{status:206,headers:{"Content-Type":"audio/mpeg","Content-Range":"bytes 2-4/10","Content-Length":"3"}});}).serve({...gatewayInput,range:"bytes=2-4"});
 assert.equal(truncated.status,206);await assert.rejects(truncated.text(),/ended before/);assert.deepEqual(opened,[otherId]);
});

test("audio gateway supports suffix ranges, 416 total size and HEAD without audio transfer", async () => {
  let calls = 0;
  const serve = gateway(new MemoryRepository(), async (_asset, range) => { calls++; return audioResponse(range); });
  const suffix = await serve.serve({ ...gatewayInput, range: "bytes=-3" });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("Content-Range"), "bytes 7-9/10");
  assert.equal(await suffix.text(), "789");
  const invalid = await serve.serve({ ...gatewayInput, range: "bytes=10-" });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("Content-Range"), "bytes */10");
  const head = await serve.serve({ ...gatewayInput, method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "10");
  assert.equal(calls, 1);
});

test("gateway refuses incorrect Range, MIME and previews rather than sending corrupt audio", async () => {
  const wrongRange = await gateway(new MemoryRepository(), async () => audioResponse(null)).serve({ ...gatewayInput, range: "bytes=2-4" });
  assert.equal(wrongRange.status, 502);
  const wrongMime = await gateway(new MemoryRepository(), async () => new Response("0123456789", { headers: { "Content-Type": "text/html" } })).serve(gatewayInput);
  assert.equal(wrongMime.status, 502);
  const repo = new MemoryRepository();
  repo.assets = [{ ...source, candidate: { ...source.candidate, audioKind: "preview" } }];
  assert.equal((await gateway(repo).serve(gatewayInput)).status, 409);
});

test("truncated streaming body fails instead of completing an incomplete file", async () => {
  const response = await gateway(new MemoryRepository(), async () => new Response("short", { headers: { "Content-Type": "audio/mpeg" } })).serve(gatewayInput);
  assert.equal(response.status, 200, "headers are sent before the body is buffered");
  await assert.rejects(response.text(), /ended before/);
});

test("source transport restricts origins and cannot forward redirects to internal hosts", async () => {
  const calls: string[] = [];
  const transport = new SourceAudioTransport({ allowedCdnOrigins: ["https://cdn.example.test"] }, (async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } });
  }) as typeof fetch);
  await assert.rejects(transport.open(source, null), /origin is not configured/);
  assert.equal(calls.length, 1);
  await assert.rejects(transport.open({ ...source, locator: { kind: "https", url: "https://evil.test/audio" } }, null), /origin is not configured/);
  assert.equal(calls.length, 1);
});

test("source fetch forwards the exact range with manual redirects and cancellation", async () => {
  const signal = new AbortController().signal;
  let captured: RequestInit | undefined;
  const transport = new SourceAudioTransport({ allowedCdnOrigins: ["https://cdn.example.test"] }, (async (_url, init) => {
    captured = init;
    return audioResponse("bytes=2-4");
  }) as typeof fetch);
  const response = await transport.open(source, "bytes=2-4", signal);
  assert.equal(new Headers(captured?.headers).get("Range"), "bytes=2-4");
  assert.equal(captured?.redirect, "manual");
  assert.ok(captured?.signal);
  assert.equal(await response.text(), "234");
});

test("active playback hint reaches only the verified worker media GET and does not alter CDN requests",async()=>{
 const requests:Array<{url:string;headers:Headers}>=[],workerAsset:StoredAudioAsset={...source,locator:{kind:"telegram-worker",protocol:"v2",documentId:"123",messageId:"42",chatScope:"primary"}};
 const transport=new SourceAudioTransport({allowedCdnOrigins:["https://cdn.example.test"],worker:{url:"https://worker.example.test",secret:"synthetic-secret-for-playback-tests",chatScope:"primary"}},(async(url,init)=>{
  const address=String(url);requests.push({url:address,headers:new Headers(init?.headers)});
  if(address.endsWith("/audio-info"))return Response.json({fileId:"123",size:10,mimeType:"audio/mpeg",metadata:canonical.metadata});
  return audioResponse(new Headers(init?.headers).get("Range"));
 }) as typeof fetch);
 const repository=new MemoryRepository();repository.assets=[workerAsset];const playback=new RecordingAudioGateway(repository,transport);
 const response=await playback.serve({...gatewayInput,range:"bytes=2-4",playback:true});assert.equal(response.status,206);assert.equal(await response.text(),"234");
 assert.equal(requests[0].headers.has("X-Sakura-Playback"),false,"Metadata preflight remains separate from streaming");
 const media=requests[1];assert.equal(media.url,"https://worker.example.test/v2/audio/primary/42");assert.equal(media.headers.get("X-Sakura-Playback"),"1");assert.equal(media.headers.get("Range"),"bytes=2-4");
 assert.match(media.headers.get("If-Match")!,/^"[a-f0-9]{64}"$/);assert.equal(media.headers.get("If-Range"),media.headers.get("If-Match"));
 await (await playback.serve({...gatewayInput,range:"bytes=2-4"})).text();assert.equal(requests.at(-1)!.headers.has("X-Sakura-Playback"),false,"Manual full-download ranges retain bulk delivery");
 await (await transport.open(source,"bytes=2-4",undefined,{playback:true})).text();assert.equal(requests.at(-1)!.url,source.locator.kind==="https"?source.locator.url:"");
 assert.equal(requests.at(-1)!.headers.has("X-Sakura-Playback"),false,"Direct CDN requests never receive the custom hint");
});

test("worker transport inspects existing audio metadata then streams, with no bot/download calls", async () => {
  const calls: string[] = [];
  const workerAsset = { ...source, locator: { kind: "telegram-worker" as const, messageId: "42", chatScope: "musicshuntersbot" } };
  const transport = new SourceAudioTransport({ allowedCdnOrigins: [], worker: { url: "https://worker.example.test", secret: "server-only", chatScope: "musicshuntersbot" } }, (async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/audio-info")) return Response.json({ size: 10, mimeType: "audio/mpeg", title: "Finesse", artist: "Bruno Mars", duration: 191 });
    return audioResponse(null);
  }) as typeof fetch);
  assert.equal(await (await transport.open(workerAsset, null)).text(), "0123456789");
  assert.deepEqual(calls, ["https://worker.example.test/audio-info", "https://worker.example.test/audio/42"]);
});

test("worker transport rejects wrong actual recording and unsupported fallback chat", async () => {
  let calls = 0;
  const asset = { ...source, locator: { kind: "telegram-worker" as const, messageId: "42", chatScope: "primary" } };
  const transport = new SourceAudioTransport({ allowedCdnOrigins: [], worker: { url: "https://worker.example.test", secret: "private", chatScope: "primary" } }, (async () => {
    calls++;
    return Response.json({ size: 10, mimeType: "audio/mpeg", title: "Finesse (Remix)", artist: "Bruno Mars", duration: 217 });
  }) as typeof fetch);
  await assert.rejects(transport.open(asset, null), /identity does not match/);
  await assert.rejects(transport.open({ ...asset, locator: { ...asset.locator, chatScope: "fallback" } }, null), /scope is not supported/);
  assert.equal(calls, 1);
});

test("read-only PostgreSQL repository parameterizes references and scopes private asset queries", async () => {
  const statements: { text: string; values: readonly unknown[] }[] = [];
  const read: ReadonlySql = async <Row>(text: string, values: readonly unknown[]) => { statements.push({ text, values }); return [] as Row[]; };
  const repo = new PostgresRecordingRepository(read);
  await repo.findByReference({ provider: "legacy", id: "x' OR 1=1 --" });
  await repo.findAudio(recordingId, assetId, accountId);
  assert.ok(statements.every((entry) => /^SELECT\b/.test(entry.text)));
  assert.ok(!statements[0].text.includes("x' OR"));
  assert.equal(statements[0].values[2], "x' OR 1=1 --");
  assert.ok(statements[1].text.includes("owner_account_id = $3::uuid"));
  assert.deepEqual(statements[1].values, [recordingId, assetId, accountId]);
});

test("fresh source discovery accepts verified exact metadata without downloading a file",async()=>{
 const calls:string[]=[];const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(url)=>{
  calls.push(String(url));return Response.json({status:"ready",audio:{messageId:"42",chatScope:"primary",metadata:canonical.metadata,size:5000,mimeType:"audio/mpeg"}});
 })as typeof fetch);
 const result=await discovery.discover(canonical);
 assert.equal(result.status,"ready");assert.deepEqual(calls,["https://worker.example.test/v2/resolve"]);
 if(result.status==="ready")assert.equal(result.asset.locator.kind,"telegram-worker");
});

test("current worker fallback uses exact catalog URL and refuses returned remix",async()=>{
 const requests:{url:string;body:Record<string,unknown>}[]=[];
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(url,init)=>{
  requests.push({url:String(url),body:JSON.parse(String(init?.body))});
  if(String(url).endsWith("/v2/resolve"))return Response.json({error:"No route"},{status:404});
  if(String(url).endsWith("/search-and-select"))return Response.json({messageId:42,title:"Finesse",artist:"Bruno Mars",duration:191});
  return Response.json({title:"Finesse (Remix)",artist:"Bruno Mars",duration:217,size:5000,mimeType:"audio/mpeg"});
 })as typeof fetch);
 const result=await discovery.discover(canonical);assert.equal(result.status,"review");
 assert.equal(requests[1].body.query,"https://www.deezer.com/track/123");
 assert.ok(requests.every(request=>!request.url.endsWith("/download")));
});

test("worker signed URLs are minted once, expire safely and include no bearer credentials",async()=>{
 let calls=0;const asset={...source,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary",protocol:"v1" as const}};
 const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:"https://worker.example.test",secret:"bearer-secret",chatScope:"primary"}},(async()=>{
  calls++;return Response.json({path:"/audio/42?exp=123&sig=signed",expiresAt:Math.floor(Date.now()/1000)+1800});
 })as typeof fetch);
 const first=await transport.signedPlaybackUrl(asset),second=await transport.signedPlaybackUrl(asset);
 assert.equal(first,second);assert.equal(calls,1);assert.ok(!first?.includes("bearer-secret"));
});

test("document-bound worker playback accepts only a signed URL for its exact validated file",async()=>{
 const worker={...source,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary",protocol:"v2" as const,documentId:"123"}},secret="generated-signing-secret";
 const expectedTag='"'+createHash("sha256").update(JSON.stringify(["primary","42","123",10,"audio/mpeg"])).digest("hex")+'"';
 for(const mode of ["unbound","wrong-tag","wrong-signature","valid"]){
  let calls=0,requestedTag:unknown;const transport=new SourceAudioTransport({allowedCdnOrigins:[],localV2Signing:false,worker:{url:"https://worker.example.test",secret,chatScope:"primary"}},(async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));requestedTag=body.documentTag;
   const expiresAt=Math.floor(Date.now()/1000)+1800,tag=mode==="wrong-tag"?'"'+"f".repeat(64)+'"':expectedTag;
   const payload=mode==="unbound"?["primary","42",expiresAt]:["primary","42",expiresAt,tag];
   const signature=mode==="wrong-signature"?"0".repeat(64):createHmac("sha256",secret).update(JSON.stringify(payload)).digest("hex");
   const query=new URLSearchParams({exp:String(expiresAt),sig:signature,...(mode==="unbound"?{}:{documentTag:tag})});
   return Response.json({path:"/v2/audio/primary/42?"+query,expiresAt});
  })as typeof fetch);
  const url=await transport.signedPlaybackUrl(worker);
  assert.equal(requestedTag,expectedTag);
  if(mode==="valid"){assert.equal(new URL(url!).searchParams.get("documentTag"),expectedTag);assert.equal(await transport.signedPlaybackUrl(worker),url);assert.equal(calls,1);}
  else assert.equal(url,undefined);
 }
});

test("verified v2 worker targets sign locally with document-bound credentials and configured scopes",async()=>{
 const secret="local-signing-secret-for-performance-test",worker={...source,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary",protocol:"v2" as const,documentId:"123"}};
 let calls=0;const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:"https://worker.example.test",secret,chatScope:"primary",allowedChatScopes:["fallback"]}},(async()=>{calls++;throw new Error("Ready playback must not fetch the worker");})as typeof fetch);
 const url=new URL((await transport.signedPlaybackUrl(worker))!),tag='"'+createHash("sha256").update(JSON.stringify(["primary","42","123",10,"audio/mpeg"])).digest("hex")+'"';
 assert.equal(url.origin,"https://worker.example.test");assert.equal(url.pathname,"/v2/audio/primary/42");assert.equal(url.searchParams.get("documentTag"),tag);
 assert.equal(url.searchParams.get("sig"),createHmac("sha256",secret).update(JSON.stringify(["primary","42",Number(url.searchParams.get("exp")),tag])).digest("hex"));
 assert.equal(calls,0);assert.ok(!url.href.includes(secret));assert.equal(await transport.signedPlaybackUrl({...worker,locator:{...worker.locator,chatScope:"unconfigured"}}),undefined);
 assert.equal(await transport.signedPlaybackUrl({...worker,locator:{...worker.locator,documentId:undefined}}),undefined);
 const changed=new URL((await transport.signedPlaybackUrl({...worker,locator:{...worker.locator,documentId:"124"}}))!);assert.notEqual(changed.searchParams.get("documentTag"),tag);assert.notEqual(changed.searchParams.get("sig"),url.searchParams.get("sig"));
 for(const origin of ["http://worker.example.test","https://user:password@worker.example.test","https://worker.example.test?untrusted=1"]){
  const invalid=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:origin,secret,chatScope:"primary"}});assert.equal(await invalid.signedPlaybackUrl(worker),undefined);
 }
});

test("ready resolution reuses selected asset evidence without exposing it or crossing accounts",async()=>{
 class Repository extends MemoryRepository {lookups=0;override async findAudio(id:string,asset:string){this.lookups++;return super.findAudio(id,asset);}}
 const repository=new Repository();repository.assets=[{...source,sha256:"a".repeat(64),ownerAccountId:accountId}];
 const result=await new RecordingResolver(repository,[]).resolve({reference},accountId),transport=new SourceAudioTransport({allowedCdnOrigins:["https://cdn.example.test"]});
 const promotion={configured:true,needsPreparation(){return false;}} as unknown as AudioPromotions;
 const jobs=new AudioResolutionJobs(async()=>[],repository,{} as RecordingIngestor,{} as WorkerAudioDiscovery,{} as RecordingResolver,undefined,promotion);
 assert.equal(await jobs.needsPreparation(result,accountId),false);await new PlaybackTargets(repository,transport).decorate(result,accountId);assert.equal(repository.lookups,0);
 assert.ok(!JSON.stringify(result).includes("ownerAccountId"));
 await new PlaybackTargets(repository,transport).decorate(JSON.parse(JSON.stringify(result)),accountId);assert.equal(repository.lookups,1);
 await new PlaybackTargets(repository,transport).decorate(result,otherId);assert.equal(repository.lookups,2);
});

function ingestionDatabase(){
 const records=new Map<string,Record<string,unknown>>(),aliases=new Map<string,string>();
 const artists=new Map<string,{id:string;name:string}>(),credits=new Map<string,{artistId:string;position:number}[]>();
 const albums=new Map<string,{id:string;title:string}>(),recordingAlbums=new Map<string,string[]>();
 const signatures=new Map<string,string>();
 const statements:string[]=[];
 const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
  statements.push(statement);
  let rows:unknown[]=[];
  if(statement.includes('FROM sakura_v2."ExternalReference" e JOIN')){
   const requested=JSON.parse(String(args[0])) as {provider:string;scope:string;id:string}[];
   const projection=JSON.parse(String(args[1])) as {artist:{provider:string;id:string}|null;album:{provider:string;id:string}|null};
   const selectedArtist=projection.artist?artists.get(JSON.stringify([projection.artist.provider,projection.artist.id]))?.id:null,selectedAlbum=projection.album?albums.get(JSON.stringify([projection.album.provider,projection.album.id]))?.id:null;
   rows=[...new Set(requested.flatMap(ref=>{const id=aliases.get(JSON.stringify([ref.provider,ref.scope,ref.id]));return id?[id]:[];}))].map(id=>({id,metadata:records.get(id),catalogIngestionSignature:signatures.get(id),artistId:(credits.get(id)||[]).some(credit=>credit.artistId===selectedArtist)?selectedArtist:null,albumId:(recordingAlbums.get(id)||[]).includes(selectedAlbum||"")?selectedAlbum:null,
    artistProjections:(credits.get(id)||[]).flatMap(credit=>[...artists.entries()].filter(([,artist])=>artist.id===credit.artistId).map(([key])=>{const[provider,artistId]=JSON.parse(key);return{provider,id:artistId,position:credit.position};})),
    references:[...aliases.entries()].filter(([,recording])=>recording===id).map(([key])=>{const[provider,scope,referenceId]=JSON.parse(key);return{provider,id:referenceId,...(scope?{scope}:{})};})}));
  }
  else if(statement.startsWith('INSERT INTO sakura_v2."Recording"')){records.set(String(args[0]),JSON.parse(String(args[1])));signatures.set(String(args[0]),JSON.parse(String(args[2])).catalogIngestionSignature);}
  else if(statement.startsWith('UPDATE sakura_v2."Recording"')){records.set(String(args[0]),{...records.get(String(args[0])),...JSON.parse(String(args[1]))});if(args[2])signatures.set(String(args[0]),String(args[2]));}
  else if(statement.startsWith('INSERT INTO sakura_v2."ExternalReference"')){for(const ref of JSON.parse(String(args[0]))){const key=JSON.stringify([ref.provider,ref.scope,ref.id]);if(!aliases.has(key))aliases.set(key,String(args[1]));}}
  else if(statement.startsWith("SELECT e.provider")){rows=JSON.parse(String(args[0])).flatMap((ref:{provider:string;scope:string;id:string})=>{const id=aliases.get(JSON.stringify([ref.provider,ref.scope,ref.id]));return id?[{provider:ref.provider,scope:ref.scope,external_id:ref.id,recording_id:id}]:[];});}
  else if(statement.startsWith("SELECT recording_id")){const id=aliases.get(JSON.stringify(args.slice(0,3)));if(id)rows=[{recording_id:id}];}
  else if(statement.startsWith('INSERT INTO sakura_v2."Artist"')){rows=JSON.parse(String(args[0])).map((artist:{provider:string;id:string;name:string})=>{const key=JSON.stringify([artist.provider,artist.id]),id=artists.get(key)?.id??`55555555-5555-4555-8555-${String(artists.size+1).padStart(12,"0")}`;artists.set(key,{id,name:artist.name});return{id,provider:artist.provider,external_id:artist.id};});}
  else if(statement.startsWith('INSERT INTO sakura_v2."RecordingArtist"')){const id=String(args[0]);for(const projection of JSON.parse(String(args[1]))){const next=(credits.get(id)??[]).filter(credit=>credit.artistId!==projection.id);credits.set(id,[...next,{artistId:projection.id,position:projection.position}]);}}
  else if(statement.startsWith('DELETE FROM sakura_v2."RecordingArtist"')){const id=String(args[0]),kept=args[1]as string[];credits.set(id,(credits.get(id)??[]).filter(credit=>kept.includes(credit.artistId)));}
  else if(statement.startsWith('INSERT INTO sakura_v2."Album"')){const key=JSON.stringify(args.slice(0,2)),id=albums.get(key)?.id??`66666666-6666-4666-8666-${String(albums.size+1).padStart(12,"0")}`;albums.set(key,{id,title:String(args[2])});rows=[{id}];}
  else if(statement.startsWith('INSERT INTO sakura_v2."RecordingAlbum"')){const id=String(args[0]),albumId=String(args[1]);recordingAlbums.set(id,[...new Set([...(recordingAlbums.get(id)||[]),albumId])]);}
  return rows as Row[];
 };
 const transaction:SqlTransaction=async operation=>operation(query);
 return{records,aliases,artists,credits,albums,recordingAlbums,transaction,statements};
}

test("batched identical ingestion retains exact proof with two reads and no repeated writes",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const selected:CatalogRecording={...catalog,artistCredits:[{name:"Bruno Mars",role:"primary",reference:{provider:"deezer",id:"42"}},{name:"Guest A",role:"featured",reference:{provider:"deezer",id:"43"}},{name:"Guest B",role:"featured",reference:{provider:"deezer",id:"44"}}],albumReference:{provider:"deezer",id:"24"},albumTitle:"Album"};
 const first=await ingestor.ensureCatalog(selected);assert.equal(database.statements.length,10);
 database.statements.length=0;const second=await ingestor.ensureCatalog(selected);
 assert.deepEqual(second,first);assert.equal(database.statements.length,2);
 assert.ok(database.statements.every(statement=>statement.startsWith("SELECT")));
 const changed={...selected,coverUrl:"https://example.test/new-cover.jpg"};database.statements.length=0;
 const refreshed=await ingestor.ensureCatalog(changed);assert.equal(refreshed.recordingId,first.recordingId);assert.equal(database.records.get(first.recordingId)?.coverUrl,changed.coverUrl);
 assert.equal(database.statements.length,10);
});

test("batch indexing starts three consumers, retains order and cancels queued work on failure",async()=>{
 const ingestor=new RecordingIngestor(async operation=>operation(async<Row>()=>[] as Row[]),[]);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let active=0,maximum=0,calls=0;
 ingestor.ensureRecording=async ref=>{calls++;active++;maximum=Math.max(maximum,active);await gate;active--;return{...canonical,recordingId:ref.id};};
 const items=Array.from({length:8},(_,index)=>({reference:{provider:"deezer" as const,id:String(index+1)}}));
 const pending=ingestor.ensureRecordings(items);await Promise.resolve();assert.equal(calls,3);release();
 assert.deepEqual((await pending).map(recording=>recording.recordingId),items.map(item=>item.reference.id));assert.equal(maximum,3);
 let failedCalls=0;ingestor.ensureRecording=async ref=>{failedCalls++;if(ref.id==="1")throw new Error("Exact variant conflict");return canonical;};
 await assert.rejects(ingestor.ensureRecordings(items),/Exact variant conflict/);assert.ok(failedCalls<=3);
 const stop=new AbortController();stop.abort();await assert.rejects(ingestor.ensureRecordings(items,stop.signal),{name:"AbortError"});
});

test("batch failure owns entered SQL work until all consumers settle",async()=>{
 const ingestor=new RecordingIngestor(async operation=>operation(async<Row>()=>[] as Row[]),[]);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let finished=false,entered=0;
 ingestor.ensureRecording=async ref=>{entered++;if(ref.id==="1")throw new Error("Exact conflict");await gate;return canonical;};
 const pending=ingestor.ensureRecordings(Array.from({length:8},(_,index)=>({reference:{provider:"deezer" as const,id:String(index+1)}})));
 const observed=pending.catch(error=>{finished=true;throw error;});
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(entered,3);assert.equal(finished,false);
 release();await assert.rejects(observed,/Exact conflict/);assert.equal(finished,true);
});

test("unchanged ingestion keeps last primary and current release projections",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const selected:CatalogRecording={...catalog,artistCredits:[{name:"A",role:"primary",reference:{provider:"deezer",id:"41"}},{name:"B",role:"primary",reference:{provider:"deezer",id:"42"}}],albumReference:{provider:"deezer",id:"24"},albumTitle:"Album A"};
 const first=await ingestor.ensureCatalog(selected);assert.equal(first.artistId,database.artists.get(JSON.stringify(["deezer","42"]))?.id);
 const alternate={...selected,albumReference:{provider:"deezer" as const,id:"25"},albumTitle:"Album B"};
 const changed=await ingestor.ensureCatalog(alternate);assert.notEqual(changed.albumId,first.albumId);
 database.statements.length=0;assert.deepEqual(await ingestor.ensureCatalog(alternate),changed);assert.equal(database.statements.length,2);
});

test("an unchanged ingestion signature never skips repair of missing exact projections",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const selected:CatalogRecording={...catalog,artistCredits:[{name:"Lead",role:"primary",reference:{provider:"deezer",id:"41"}},{name:"Guest",role:"featured",reference:{provider:"deezer",id:"42"}}],albumReference:{provider:"deezer",id:"24"},albumTitle:"Album"};
 const first=await ingestor.ensureCatalog(selected);database.credits.set(first.recordingId,database.credits.get(first.recordingId)!.slice(0,1));
 database.statements.length=0;assert.deepEqual(await ingestor.ensureCatalog(selected),first);assert.equal(database.credits.get(first.recordingId)!.length,2);assert.equal(database.statements.length,10);
 database.recordingAlbums.delete(first.recordingId);database.statements.length=0;assert.deepEqual(await ingestor.ensureCatalog(selected),first);assert.equal(database.statements.length,10);
 database.statements.length=0;assert.deepEqual(await ingestor.ensureCatalog(selected),first);assert.equal(database.statements.length,2);
});

test("partial expected credits hydrate exact metadata while wrong known guest fails before any write",async()=>{
 const database=ingestionDatabase(),exact={...catalog,metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Rei"],artistsComplete:true,durationMs:199486}};
 const ingestor=new RecordingIngestor(database.transaction,[new MockCatalog(exact)]);
 const indexed=await ingestor.ensureRecording(reference,{title:"INERTIA",artists:["SawanoHiroyuki[nZk]"],artistsComplete:false,durationMs:199000});
 assert.deepEqual(indexed.metadata.artists,["SawanoHiroyuki[nZk]","Rei"]);
 await assert.rejects(ingestor.ensureRecording(reference,{title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Wrong Guest"],artistsComplete:false,durationMs:199000}),(error:unknown)=>error instanceof RecordingIdentityConflict&&error.reason==="catalog-mismatch"&&error.rejections.includes("artist"));
 assert.equal(database.records.size,1);
});

test("exact featured artist projections are individually retained and repeat indexing is idempotent",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const artistCredits:NonNullable<CatalogRecording["artistCredits"]>=[{name:"Bruno Mars",role:"primary",reference:{provider:"deezer",id:"789"}},{name:"Cardi B",role:"featured",reference:{provider:"deezer",id:"987"}}];
 const selected={...catalog,metadata:{title:"Finesse (Remix; feat. Cardi B)",artists:["Bruno Mars","Cardi B"],artistsComplete:true,durationMs:217000},artistCredits};
 const first=await ingestor.ensureCatalog(selected),again=await ingestor.ensureCatalog(selected);
 assert.equal(first.recordingId,again.recordingId);assert.equal(database.artists.size,2);
 assert.deepEqual(first.artistCredits,artistCredits);assert.deepEqual(database.records.get(first.recordingId)?.artistCredits,artistCredits);
 const projected=(database.credits.get(first.recordingId)??[]).sort((a,b)=>a.position-b.position);
 assert.deepEqual(projected.map(credit=>credit.position),[0,1]);assert.equal(first.artistId,projected[0].artistId);assert.notEqual(projected[0].artistId,projected[1].artistId);
});

test("exact catalog ingestion deduplicates alternate releases via verified ISRC",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const first=await ingestor.ensureCatalog(catalog);
 const another={...catalog,reference:{provider:"deezer" as const,id:"456"},references:[{provider:"deezer" as const,id:"456"},isrc]};
 const second=await ingestor.ensureCatalog(another);
 assert.equal(first.recordingId,second.recordingId);assert.equal(database.records.size,1);assert.equal(database.aliases.size,3);
});

test("ISRC conflict with remix metadata never overwrites original recording",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 await ingestor.ensureCatalog(catalog);
 const wrong={...catalog,reference:{provider:"deezer" as const,id:"456"},references:[{provider:"deezer" as const,id:"456"},isrc],metadata:{title:"Finesse (Remix)",artists:["Bruno Mars","Cardi B"],durationMs:217000}};
 await assert.rejects(ingestor.ensureCatalog(wrong),RecordingIdentityConflict);
 assert.equal(database.records.size,1);assert.equal(database.aliases.size,2);
});

test("reindex without genre metadata preserves independently verified album genres",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const first=await ingestor.ensureCatalog({...catalog,genres:["Funk"]});await ingestor.ensureCatalog(catalog);
 assert.deepEqual(database.records.get(first.recordingId)?.genres,["Funk"]);
});

test("recording mismatch cannot be persisted as a ready audio asset",async()=>{
 let writes=0;const ingestor=new RecordingIngestor(async operation=>operation(async<Row>()=>{writes++;return[]as Row[];}),[]);
 await assert.rejects(ingestor.persistAudio(canonical,{...source,candidate:{...source.candidate,metadata:{title:"Finesse (Remix)",artists:["Bruno Mars"],durationMs:217000}}}),/failed recording validation/);
 assert.equal(writes,0);
});

test("public import recognizes scoped provider playlist links and refuses arbitrary/internal URLs",()=>{
 assert.deepEqual(collectionUrl("https://www.deezer.com/playlist/123"),{provider:"deezer",id:"123"});
 assert.equal(collectionUrl("https://www.youtube.com/playlist?list=PL1234567890123456").provider,"youtube");
 assert.throws(()=>collectionUrl("https://localhost/private"));assert.throws(()=>collectionUrl("https://open.spotify.com/track/0123456789ABCDEFGHIJKL"));
});

test("Deezer import preview transfers metadata only and exposes exact track references",async()=>{
 const ingestor=new RecordingIngestor(ingestionDatabase().transaction,[]);
 const importer=new MusicCollectionImporter(new DeezerCatalogService(),ingestor,ingestionDatabase().transaction,{},(async()=>Response.json({id:123,title:"Favorites",nb_tracks:1,tracks:{data:[{id:456,title:"Finesse",duration:191,artist:{id:789,name:"Bruno Mars"},album:{id:987,title:"24K Magic"}}]}}))as typeof fetch);
 const preview=await importer.preview("https://www.deezer.com/playlist/123");assert.equal(preview.items.length,1);assert.deepEqual(preview.items[0].reference,{provider:"deezer",id:"456"});assert.equal(preview.items[0].status,"matched");
});

test("audio jobs persist progress, coalesce running work and enforce account polling",async()=>{
 const repo=new MemoryRepository();repo.assets=[];
 const stored=new Map<string,{id:string;accountId:string;recordingId:string;state:string;result:unknown;attempts:number}>();
 const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
  let result:unknown[]=[];
  if(statement.startsWith('INSERT INTO sakura_v2."AudioResolveJob"')){const job={id:String(args[0]),accountId:String(args[1]),recordingId:String(args[2]),state:"queued",result:null,attempts:0};stored.set(job.id,job);result=[{id:job.id}];}
  else if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=\'resolving\'')){const job=stored.get(String(args[0]));if(job?.state==="queued"){job.state="resolving";job.attempts++;result=[job];}}
  else if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=$2')){const job=stored.get(String(args[0]));if(job){job.state=String(args[1]);job.result=JSON.parse(String(args[2]));}}
  else if(statement.includes('WHERE id=$1::uuid AND account_id=$2::uuid')){const job=stored.get(String(args[0]));if(job&&job.accountId===args[1])result=[job];}
  return result as Row[];
 };
 class Ingestor extends RecordingIngestor{override async persistAudio(_recording:CanonicalRecording,asset:StoredAudioAsset){repo.assets.push(asset);}}
 const ingestor=new Ingestor(ingestionDatabase().transaction,[]);let calls=0;
 const jobs=new AudioResolutionJobs(query,repo,ingestor,{async discover(){calls++;await new Promise(resolve=>setTimeout(resolve,10));return{status:"ready",asset:source};}},new RecordingResolver(repo,[]));
 const pending=await jobs.enqueue(canonical,accountId);assert.equal(pending.status,"pending");if(pending.status!=="pending")return;
 assert.equal(await jobs.get(pending.jobId,otherId),null);
 const one=jobs.process(pending.jobId),two=jobs.process(pending.jobId);assert.equal(one,two);await one;
 assert.equal(calls,1);assert.equal((await jobs.get(pending.jobId,accountId))?.status,"resolved");
});

test("expired final audio job lease terminates polling with a retryable failure",async()=>{
 const repo=new MemoryRepository();
 const job={id:assetId,accountId,recordingId,state:"resolving",result:null as unknown,leaseUntil:new Date(0),attempts:2};
 const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
  if(statement.startsWith("SELECT"))return [job] as Row[];
  assert.ok(statement.includes("attempts>=2")&&statement.includes("lease_until<NOW()"));
  job.state="failed";job.result=JSON.parse(String(args[2]));return [job] as Row[];
 };
 const jobs=new AudioResolutionJobs(query,repo,new RecordingIngestor(ingestionDatabase().transaction,[]),{async discover(){throw new Error("Must not start a third source attempt");}},new RecordingResolver(repo,[]));
 const result=await jobs.get(assetId,accountId);assert.equal(result?.status,"unavailable");
 if(result?.status==="unavailable")assert.equal(result.retryable,true);
 assert.equal(job.state,"failed");
});

test("slow source recovery leaves preparation only the remaining job lease budget",async(context)=>{
 const repo=new MemoryRepository();repo.assets=[];
 const job={id:assetId,accountId,recordingId,state:"queued",result:null as unknown,attempts:0};
 const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
  if(statement.startsWith('INSERT INTO sakura_v2."AudioResolveJob"'))return[{id:job.id}]as Row[];
  if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=\'resolving\'')){assert.ok(statement.includes("INTERVAL '115 seconds'"));job.state="resolving";job.attempts++;return[job]as Row[];}
  if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=$2')){job.state=String(args[1]);job.result=JSON.parse(String(args[2]));return[];}
  return[job]as Row[];
 };
 const startedAt=Date.now(),budgets:number[]=[];let elapsed=0;
 context.mock.method(Date,"now",()=>startedAt+elapsed);
 context.mock.method(AbortSignal,"timeout",(milliseconds:number)=>{budgets.push(milliseconds);return new AbortController().signal;});
 class Ingestor extends RecordingIngestor{override async persistAudio(_recording:CanonicalRecording,asset:StoredAudioAsset){repo.assets.push(asset);}}
 class Promotions extends AudioPromotions{
  override needsPreparation(){return true;}
  override async prepare():Promise<StoredAudioAsset>{throw new AudioPromotionError("provider","Preparation reached the remaining transfer deadline");}
 }
 const ingestor=new Ingestor(ingestionDatabase().transaction,[]);
 const jobs=new AudioResolutionJobs(query,repo,ingestor,{async discover(){elapsed=80000;return{status:"ready",asset:source};}},new RecordingResolver(repo,[]),undefined,new Promotions({async open(){throw new Error("No audio transfer is needed in this regression");}},ingestor));
 const pending=await jobs.enqueue(canonical,accountId);assert.equal(pending.status,"pending");if(pending.status!=="pending")return;
 await jobs.process(pending.jobId);
 assert.deepEqual(budgets,[90000,30000]);assert.equal((await jobs.get(pending.jobId,accountId))?.status,"resolved");assert.equal(repo.assets[0].assetId,source.assetId);
});

test("YouTube metadata parser preserves braces and script delimiters inside song titles",()=>{
 const value={title:'Song }; with \\"quoted\\" text',nested:{items:[{title:"Japanese 日本語"}]}};
 assert.deepEqual(youtubeInitialData(`<script>var ytInitialData =\n${JSON.stringify(value)}; anotherScript();</script>`),value);
 assert.throws(()=>youtubeInitialData('var ytInitialData = {"title":"cut off"'),/incomplete/);
});

test("playlist imports stop repeating provider pagination instead of hanging indefinitely",async()=>{
 const ingestor=new RecordingIngestor(ingestionDatabase().transaction,[]);
 let calls=0;
 const importer=new MusicCollectionImporter(new DeezerCatalogService(),ingestor,ingestionDatabase().transaction,{},(async()=>{
  calls++;return Response.json(calls===1?{title:"Broken playlist",tracks:{data:[],next:"https://api.deezer.com/playlist/123/tracks?index=0"}}:{data:[],next:"https://api.deezer.com/playlist/123/tracks?index=0"});
 })as typeof fetch);
 await assert.rejects(importer.preview("https://www.deezer.com/playlist/123"),/repeating/);assert.equal(calls,2);
});

test("recording mutations reject cross-origin browser requests before reading the body",async()=>{
 const body=JSON.stringify({reference});
 await assert.rejects(readResolveInput(new Request("https://sakura.example/resolve",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://other.example"},body})),/origin/);
 const valid=await readResolveInput(new Request("http://0.0.0.0:3000/resolve",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://localhost:3000",Host:"localhost:3000"},body}));
 assert.deepEqual(valid.reference,reference);
});

test("PostgreSQL null provider scope decodes as an unscoped catalogue reference",async()=>{
 const repository=new PostgresRecordingRepository(async<Row>(statement:string)=>{
  assert.ok(statement.includes("jsonb_strip_nulls"));
  return[{id:recordingId,metadata:canonical.metadata,references:[{provider:"deezer",id:"123",scope:null}]}]as Row[];
 });
 const found=await repository.findByReference(reference);assert.deepEqual(found?.references,[reference]);
});

test("byte-identical verified full assets form one playback choice while distinct files require review",async()=>{
 const repo=new MemoryRepository(),hash="a".repeat(64);
 repo.assets=[{...source,candidate:{...source.candidate,references:[{provider:"telegram",scope:"primary",id:"42"}]},sha256:hash},
  {...source,assetId:otherId,candidate:{...source.candidate,candidateId:otherId,references:[{provider:"telegram",scope:"primary",id:"43"}]},sha256:hash},
  {...source,assetId:accountId,candidate:{...source.candidate,candidateId:accountId,references:[{provider:"telegram",scope:"primary",id:"44"}]}}];
 const resolver=new RecordingResolver(repo,[]);
 assert.equal((await resolver.resolve({reference},accountId)).status,"resolved");
 repo.assets[1]={...repo.assets[1],sha256:"b".repeat(64)};
 const reviewed=await resolver.resolve({reference},accountId);assert.equal(reviewed.status,"review");if(reviewed.status==="review")assert.equal(reviewed.reason,"ambiguous-audio");
});

test("Spotify fills missing original search results and retains artist portrait when optional endpoints fail",async()=>{
 const artistId="3wcj11K77LjEY1PkEazffa";
 const spotify=new SpotifyCatalogProvider("id","secret",(async(url)=>{
  const parsed=new URL(String(url));
  if(parsed.hostname==="accounts.spotify.com")return Response.json({access_token:"test-token",expires_in:3600});
  if(parsed.pathname.endsWith("/search")){
   assert.equal(parsed.searchParams.get("limit"),"10");return Response.json({tracks:{items:[{id:"2lEl1iNGpz9r2B7R5BqXSD",name:"Ye",duration_ms:231618,artists:[{id:artistId,name:"Burna Boy"}],album:{id:"0123456789ABCDEFGHIJKL",name:"Outside",images:[{url:"https://i.scdn.co/image/album"}]}}]}});
  }
  if(parsed.pathname===`/v1/artists/${artistId}`)return Response.json({id:artistId,name:"Burna Boy",images:[{url:"https://i.scdn.co/image/portrait"}],genres:[]});
  return Response.json({error:{message:"Endpoint unavailable"}},{status:403});
 })as typeof fetch);
 const service=new DeezerCatalogService((async()=>Response.json({data:[]}))as typeof fetch,spotify);
 const search=await service.search("Burna Boy Ye");assert.equal(search.tracks[0].metadata.title,"Ye");assert.equal(search.tracks[0].reference.provider,"spotify");
 const detail=await service.detail("artist",`spotify:${artistId}`);assert.equal(detail.imageUrl,"https://i.scdn.co/image/portrait");assert.deepEqual(detail.tracks,[]);
});

test("catalogue search exposes bounded per-kind continuation pages",async()=>{
 const deezerOffsets:number[]=[],spotifyOffsets:number[]=[];
 const deezer=(async(url)=>{const parsed=new URL(String(url)),offset=Number(parsed.searchParams.get("index")||0);deezerOffsets.push(offset);
  const kind=parsed.pathname.split("/").at(-1);return Response.json({total:kind==="track"?30:1,data:kind==="track"?[{id:100+offset,title:offset?"Work (R3hab Remix)":"Work",duration:220,artist:{id:1,name:"Rihanna"},album:{id:2,title:"ANTI"}}]:[]});
 })as typeof fetch;
 const spotify=new SpotifyCatalogProvider("id","secret",(async(url)=>{const parsed=new URL(String(url));if(parsed.hostname==="accounts.spotify.com")return Response.json({access_token:"page-token",expires_in:3600});
  const offset=Number(parsed.searchParams.get("offset")||0);spotifyOffsets.push(offset);return Response.json({tracks:{total:15,offset,limit:10,next:offset===0?"next":null,items:[{id:offset?"1234567890ABCDEFGHIJKL":"ABCDEFGHIJKL1234567890",name:offset?"Work (Lost Kings Remix)":"Work",duration_ms:220000,artists:[{id:"3wcj11K77LjEY1PkEazffa",name:"Rihanna"}],album:{id:"0123456789ABCDEFGHIJKL",name:"ANTI",images:[]}}]}});
 })as typeof fetch);
 const service=new DeezerCatalogService(deezer,spotify),first=await service.search("Work",undefined,{kind:"tracks"});
 assert.equal(first.totals.tracks,45);assert.equal(first.nextCursors.tracks,"1");assert.deepEqual(deezerOffsets,[0]);assert.deepEqual(spotifyOffsets,[0]);
 const second=await service.search("Work",undefined,{kind:"tracks",cursor:1});
 assert.equal(second.nextCursors.tracks,null);assert.deepEqual(deezerOffsets,[0,24]);assert.deepEqual(spotifyOffsets,[0,10]);assert.equal(second.tracks.length,2);
});

test("signed worker playback exposes an authenticated fallback for the same verified asset",async()=>{
 const repo=new MemoryRepository();repo.assets=[{...source,locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary",protocol:"v1"}}];
 const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:"https://worker.example.test",secret:"server-only-secret",chatScope:"primary"}},(async()=>Response.json({path:"/audio/42?exp=123&sig=signed",expiresAt:Math.floor(Date.now()/1000)+1800}))as typeof fetch);
 const result=await new RecordingResolver(repo,[]).resolve({reference},accountId);
 const decorated=await new PlaybackTargets(repo,transport).decorate(result,accountId);
 assert.equal(decorated.status,"resolved");
 if(decorated.status==="resolved"){
  assert.equal(decorated.playback.assetId,assetId);assert.equal(decorated.recording.recordingId,recordingId);
  assert.ok(decorated.playback.url.startsWith("https://worker.example.test/audio/42?"));
  assert.equal(decorated.playback.fallbackUrl,`/api/v2/recordings/${recordingId}/audio?assetId=${assetId}`);
  assert.ok(!JSON.stringify(decorated).includes("server-only-secret"));
 }
});

test("checksum-equivalent CDN audio outranks worker delivery in either database order",async()=>{
 const sha256="a".repeat(64),worker={...source,sha256,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}},cdn={...source,sha256,assetId:otherId,candidate:{...source.candidate,candidateId:otherId}};
 for(const assets of [[cdn,worker],[worker,cdn]]){const repo=new MemoryRepository();repo.assets=assets;const result=await new RecordingResolver(repo,[],asset=>asset.locator.kind==="https"?asset.locator.url:undefined).resolve({reference},accountId);assert.equal(result.status,"resolved");if(result.status==="resolved"){assert.equal(result.playback.assetId,otherId);assert.equal(result.playback.delivery,"cdn");assert.equal(result.playback.sha256,sha256);}}
});

test("CDN persistence refuses forged delivery evidence before database writes",async()=>{
 let writes=0;const ingestor=new RecordingIngestor(async operation=>operation(async<Row>()=>{writes++;return[]as Row[];}),[]),sha256="a".repeat(64);
 const deliveryEvidence={method:"immutable-cdn-sha256" as const,provider:"cloudinary" as const,sourceAssetId:assetId,verifiedSha256:sha256,verifiedAt:"2026-11-07T00:00:00Z"};
 for(const asset of [
  {...source,sha256,deliveryEvidence:{...deliveryEvidence,verifiedSha256:"b".repeat(64)}},
  {...source,sha256,deliveryEvidence:{...deliveryEvidence,sourceAssetId:"unscoped-worker-message"}},
  {...source,sha256,deliveryEvidence:{...deliveryEvidence,verifiedAt:"invalid"}},
  {...source,sha256,deliveryEvidence,ownerAccountId:accountId},
  {...source,sha256,deliveryEvidence,locator:{kind:"telegram-worker" as const,chatScope:"primary",messageId:"42"}},
 ])await assert.rejects(ingestor.persistAudio(canonical,asset),/delivery evidence failed validation/);
 assert.equal(writes,0);
 await ingestor.persistAudio(canonical,{...source,sha256,deliveryEvidence});assert.ok(writes>0);
});

test("CDN publication rejects private, wrong-recording and checksum-mismatched audio before upload",async()=>{
 let calls=0;const publisher=new CloudinaryAudioPublisher({cloudName:"unit",apiKey:"key",apiSecret:"secret"},(async()=>{calls++;throw new Error("Must not upload");})as typeof fetch),bytes=Buffer.from("0123456789"),sha256=createHash("sha256").update(bytes).digest("hex");
 for(const asset of [{...source,sha256,ownerAccountId:accountId},{...source,sha256,recordingId:otherId},{...source,sha256:"a".repeat(64)},{...source,sha256,candidate:{...source.candidate,metadata:{...canonical.metadata,title:"Finesse (Remix)"}}}])await assert.rejects(publisher.publish(canonical,asset,bytes),AudioPromotionError);
 assert.equal(calls,0);
});

test("CDN immutable upload rechecks delivered full digest and uses deterministic idempotent asset IDs",async()=>{
 const bytes=Buffer.from("0123456789"),sha256=createHash("sha256").update(bytes).digest("hex"),publicId=`sakura/v2/audio/${recordingId}/${sha256}`;let uploads=0;
 const publisher=new CloudinaryAudioPublisher({cloudName:"unit",apiKey:"key",apiSecret:"secret"},(async(url,init)=>{
  if(String(url).endsWith("/usage"))return Response.json({plan:"Free",credits:{usage:3.84,limit:25,used_percent:15.36}});
  if(String(url).includes("/resources/video/upload/"))return uploads?Response.json({public_id:publicId,bytes:bytes.length,version:1,format:"mp3",secure_url:`https://res.cloudinary.com/unit/video/upload/v1/${publicId}.mp3`}):Response.json({},{status:404});
  if(String(url).endsWith("/video/upload")){uploads++;const body=init?.body as FormData;assert.equal(body.get("overwrite"),"false");assert.equal(body.get("public_id"),publicId);assert.equal((body.get("file")as Blob).size,bytes.length);return Response.json({public_id:publicId,bytes:bytes.length,version:1,format:"mp3",secure_url:`https://res.cloudinary.com/unit/video/upload/v1/${publicId}.mp3`});}
  return audioResponse(null);
 })as typeof fetch);
 const first=await publisher.publish(canonical,{...source,sha256},bytes),second=await publisher.publish(canonical,{...source,sha256},bytes);
 assert.equal(first.assetId,second.assetId);assert.equal(first.sha256,sha256);assert.equal(first.locator.kind,"https");assert.equal(first.candidate.metadata,source.candidate.metadata);assert.equal(uploads,1);
});

test("exhausted CDN quota blocks upload and altered CDN bytes never become ready assets",async()=>{
 const bytes=Buffer.from("0123456789"),sha256=createHash("sha256").update(bytes).digest("hex"),publicId=`sakura/v2/audio/${recordingId}/${sha256}`;let uploads=0;
 const exhausted=new CloudinaryAudioPublisher({cloudName:"unit",apiKey:"key",apiSecret:"secret"},(async()=>Response.json({plan:"Free",credits:{usage:25,limit:25}}))as typeof fetch);
 await assert.rejects(exhausted.publish(canonical,{...source,sha256},bytes),(error:unknown)=>error instanceof AudioPromotionError&&error.reason==="quota");
 const changed=new CloudinaryAudioPublisher({cloudName:"unit",apiKey:"key",apiSecret:"secret"},(async(url)=>{if(String(url).endsWith("/usage"))return Response.json({credits:{usage:1,limit:25}});if(String(url).includes("/resources/video/upload/"))return Response.json({},{status:404});if(String(url).endsWith("/upload")){uploads++;return Response.json({public_id:publicId,bytes:10,version:1,format:"mp3",secure_url:`https://res.cloudinary.com/unit/video/upload/v1/${publicId}.mp3`});}return new Response("9876543210",{headers:{"Content-Type":"audio/mpeg"}});})as typeof fetch);
 await assert.rejects(changed.publish(canonical,{...source,sha256},bytes),(error:unknown)=>error instanceof AudioPromotionError&&error.reason==="integrity");assert.equal(uploads,1);
 await assert.rejects(completeAudio(new Response("short",{headers:{"Content-Type":"audio/mpeg"}}),10),AudioPromotionError);
});

test("CDN preparation coalesces transfer/publication and persists unchanged canonical identity",async()=>{
 const bytes=waveAudio(),sha256=createHash("sha256").update(bytes).digest("hex"),saved:StoredAudioAsset[]=[];let opens=0,publishes=0;
 class Ingestor extends RecordingIngestor{override async persistAudio(recording:CanonicalRecording,asset:StoredAudioAsset){assert.equal(recording.recordingId,recordingId);saved.push(asset);}}
 const ingestor=new Ingestor(ingestionDatabase().transaction,[]),promotions=new AudioPromotions({async open(){opens++;await new Promise(resolve=>setTimeout(resolve,10));return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"audio/wav"}});}},ingestor,{async publish(_recording,asset){publishes++;assert.equal(asset.sha256,sha256);return{...asset,locator:{kind:"https",url:"https://cdn.example.test/audio.wav"}};}});
 const worker={...source,sizeBytes:bytes.length,mimeType:"audio/wav",locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const first=promotions.prepare(canonical,worker),second=promotions.prepare(canonical,worker);assert.equal(first,second);const result=await first;assert.equal(opens,1);assert.equal(publishes,1);assert.equal(saved.length,2);assert.equal(result.recordingId,recordingId);assert.equal(result.sha256,sha256);
});

test("promotion failures stay with their source and cannot revoke another verified CDN asset",async()=>{
 const sha256=createHash("sha256").update("0123456789").digest("hex"),repo=new MemoryRepository(),ingestor=new RecordingIngestor(ingestionDatabase().transaction,[]);
 const failed={...source,assetId:otherId,candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const promotions=new AudioPromotions({async open(){return new Response("01234567890",{headers:{"Content-Type":"audio/mpeg"}});}},ingestor);
 await assert.rejects(promotions.prepare(canonical,failed),error=>error instanceof AudioPromotionError&&error.reason==="integrity");
 repo.assets=[{...source,sha256}];const resolver=new RecordingResolver(repo,[]),result=await resolver.resolve({reference},accountId);
 const jobs=new AudioResolutionJobs(async()=>[],repo,ingestor,{async discover(){throw new Error("No discovery expected");}},resolver,undefined,promotions);
 assert.equal(jobs.decoratePreparation(result).status,"resolved");
 await promotions.prepare(canonical,repo.assets[0]);assert.equal(jobs.decoratePreparation(result).status,"resolved");
 repo.assets=[failed];const failedResult=await resolver.resolve({reference},accountId);assert.equal(jobs.decoratePreparation(failedResult).status,"review");
 repo.assets=[{...source,assetId:otherId,sha256}];await promotions.prepare(canonical,repo.assets[0]);assert.equal(jobs.decoratePreparation(await resolver.resolve({reference},accountId)).status,"resolved");
});

test("late failure of a distinct source cannot overwrite successful CDN preparation",async()=>{
 const bytes=waveAudio(),sha256=createHash("sha256").update(bytes).digest("hex"),repo=new MemoryRepository(),ingestor=new RecordingIngestor(ingestionDatabase().transaction,[]);
 let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});
 const failed={...source,assetId:otherId,sha256:"b".repeat(64),candidate:{...source.candidate,candidateId:otherId},locator:{kind:"telegram-worker" as const,messageId:"41",chatScope:"primary"}};
 const good={...source,sizeBytes:bytes.length,mimeType:"audio/wav",sha256,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const promotions=new AudioPromotions({async open(asset){if(asset.assetId===otherId)await pending;return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"audio/wav"}});}},ingestor,{async publish(_recording,asset){return{...asset,assetId:accountId,candidate:{...asset.candidate,candidateId:accountId},locator:{kind:"https",url:"https://cdn.example.test/checked.wav"}};}});
 const late=promotions.prepare(canonical,failed),assertFailure=assert.rejects(late,error=>error instanceof AudioPromotionError&&error.reason==="integrity");
 const published=await promotions.prepare(canonical,good);release();await assertFailure;
 repo.assets=[published];const resolver=new RecordingResolver(repo,[]),result=await resolver.resolve({reference},accountId);
 const jobs=new AudioResolutionJobs(async()=>[],repo,ingestor,{async discover(){throw new Error("No discovery expected");}},resolver,undefined,promotions);
 assert.equal(jobs.decoratePreparation(result).status,"resolved");
});

test("ready-worker preparation jobs keep a verified original available when CDN preparation fails",async()=>{
 for(const outcome of ["ready","quota","integrity"] as const){
  const bytes=waveAudio(),repo=new MemoryRepository(),sha256=createHash("sha256").update(bytes).digest("hex");
  const worker={...source,sha256,sizeBytes:bytes.length,mimeType:"audio/wav",locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};repo.assets=[worker];
  const row={id:otherId,accountId,recordingId,state:"queued",attempts:0,result:null as unknown};
  const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
   let rows:unknown[]=[];
   if(statement.startsWith('INSERT INTO sakura_v2."AudioResolveJob"')){row.id=String(args[0]);rows=[{id:row.id}];}
   else if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=\'resolving\'')){row.state="resolving";row.attempts++;rows=[row];}
   else if(statement.startsWith('UPDATE sakura_v2."AudioResolveJob" SET state=$2')){assert.equal(args[3],row.attempts);row.state=String(args[1]);row.result=JSON.parse(String(args[2]));}
   else if(statement.includes('WHERE id=$1::uuid AND account_id=$2::uuid')&&args[0]===row.id&&args[1]===accountId)rows=[row];
   return rows as Row[];
  };
  class Ingestor extends RecordingIngestor{override async persistAudio(_recording:CanonicalRecording,asset:StoredAudioAsset){repo.assets=repo.assets.filter(a=>a.assetId!==asset.assetId).concat(asset);}}
  let publications=0,discoveries=0;const ingestor=new Ingestor(ingestionDatabase().transaction,[]);
  const promotions=new AudioPromotions({async open(){return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"audio/wav"}});}},ingestor,{async publish(_recording,asset){publications++;if(outcome!=="ready")throw new AudioPromotionError(outcome,"Preparation failed");return{...asset,assetId:otherId,candidate:{...asset.candidate,candidateId:otherId},locator:{kind:"https",url:"https://cdn.example.test/verified.wav"}};}});
  const resolver=new RecordingResolver(repo,[],asset=>asset.locator.kind==="https"?asset.locator.url:undefined);
  const jobs=new AudioResolutionJobs(query,repo,ingestor,{async discover(){discoveries++;throw new Error("An existing exact source must not start another bot search");}},resolver,undefined,promotions);
  assert.equal(await jobs.needsPreparation(await resolver.resolve({reference},accountId),accountId),true);
  const pending=await jobs.enqueue(canonical,accountId,"preparing-audio");assert.equal(pending.status,"pending");if(pending.status!=="pending")throw new Error("Expected preparation job");assert.equal(pending.stage,"preparing-audio");
  await jobs.process(pending.jobId);const result=await jobs.get(pending.jobId,accountId);assert.equal(publications,1);assert.equal(discoveries,0);
  assert.equal(result?.status,"resolved");if(result?.status!=="resolved")throw new Error("Expected validated playback");assert.equal(result.playback.sha256,sha256);assert.equal(result.recording.recordingId,recordingId);assert.equal(result.playback.delivery,outcome==="ready"?"cdn":"worker-fallback");assert.equal(result.playback.preparationFailure,outcome==="quota"?"quota":outcome==="integrity"?"cdn-integrity":undefined);
  assert.ok(repo.assets.some(a=>a.locator.kind==="telegram-worker"&&a.sha256===sha256),"Verified worker fallback must remain stored");
 }
});

test("a plain-text missing v2 route falls back to exact legacy source selection",async()=>{
 const paths:string[]=[];const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async url=>{
  paths.push(String(url));if(String(url).endsWith("/v2/resolve"))return new Response("Not Found",{status:404});
  if(String(url).endsWith("/search-and-select"))return Response.json({messageId:42});
  return Response.json({title:"Finesse",artist:"Bruno Mars",duration:191,size:5000,mimeType:"audio/mpeg"});
 })as typeof fetch);
 assert.equal((await discovery.discover(canonical)).status,"ready");assert.equal(paths.length,3);
});

test("an unsupported optional worker scope cannot disable its primary source",async()=>{
 const scopes:string[][]=[];const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary",fallbackBots:["unknownbot"]},(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));scopes.push(body.botScopes);
  if(body.botScopes.length>1)return Response.json({error:"Unknown worker chat scope"},{status:500});
  return Response.json({status:"ready",audio:{messageId:"42",chatScope:"primary",metadata:canonical.metadata,size:5000,mimeType:"audio/mpeg"}});
 })as typeof fetch);
 assert.equal((await discovery.discover(canonical)).status,"ready");assert.equal((await discovery.discover(canonical)).status,"ready");
 assert.deepEqual(scopes,[["primary","unknownbot"],["primary"],["primary"]]);
});

test("legacy selection continues after a wrong version to the other exact catalog reference",async()=>{
 const queries:string[]=[];let chosen="";const alternate={provider:"spotify" as const,id:"0123456789ABCDEFGHIJKL"};
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(url,init)=>{
  const body=JSON.parse(String(init?.body));if(String(url).endsWith("/v2/resolve"))return new Response("Not Found",{status:404});
  if(String(url).endsWith("/search-and-select")){chosen=String(body.query);queries.push(chosen);return Response.json({messageId:chosen.includes("spotify")?43:42});}
  return Response.json({title:chosen.includes("spotify")?"Finesse":"Finesse (Remix)",artist:"Bruno Mars",duration:chosen.includes("spotify")?191:217,size:5000,mimeType:"audio/mpeg"});
 })as typeof fetch);
 const result=await discovery.discover({...canonical,references:[reference,alternate,isrc]});assert.equal(result.status,"ready");
 assert.deepEqual(queries,["https://www.deezer.com/track/123","https://open.spotify.com/track/0123456789ABCDEFGHIJKL"]);
});

test("source discovery adds only exact metadata-and-ISRC verified provider aliases",async()=>{
 const alternate={provider:"spotify" as const,id:"0123456789ABCDEFGHIJKL"};let received:Record<string,unknown>={};
 const provider:CatalogProvider={provider:"spotify",async getExact(){return null;},async getByIsrc(){return[{...catalog,metadata:{...catalog.metadata,artistsComplete:true},reference:alternate,references:[alternate,isrc]},{...catalog,reference:{...alternate,id:"ABCDEFGHIJKL0123456789"},references:[{...alternate,id:"ABCDEFGHIJKL0123456789"},isrc],metadata:{...canonical.metadata,title:"Finesse (Remix)",durationMs:217000,artistsComplete:true}}];}};
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(_url,init)=>{received=JSON.parse(String(init?.body));return Response.json({status:"unavailable"});})as typeof fetch,[provider]);
 await discovery.discover(canonical);assert.deepEqual(received.references,[reference,isrc,alternate]);
});

test("rediscovering one scoped immutable source is idempotent and unconfigured scopes are refused",async()=>{
 let scope="primary";const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async()=>Response.json({status:"ready",audio:{messageId:"42",chatScope:scope,metadata:canonical.metadata,size:5000,mimeType:"audio/mpeg"}}))as typeof fetch);
 const one=await discovery.discover(canonical),two=await discovery.discover(canonical);assert.equal(one.status,"ready");assert.equal(two.status,"ready");
 if(one.status==="ready"&&two.status==="ready")assert.equal(one.asset.assetId,two.asset.assetId);
 scope="unconfigured";assert.equal((await discovery.discover(canonical)).status,"unavailable");
});

test("Deezer ISRC lookup follows exact provider metadata and rejects recycled identifiers",async()=>{
 const paths:string[]=[];let returnedIsrc=isrc.id;
 const provider=new DeezerCatalogProvider((async url=>{paths.push(String(url));if(String(url).includes("/track/isrc:"))return Response.json({id:123});return Response.json({id:123,title:"Finesse",duration:191,isrc:returnedIsrc,artist:{id:1,name:"Bruno Mars"},album:{id:1,title:"24K Magic"}});})as typeof fetch);
 assert.equal((await provider.getByIsrc!(isrc.id)).length,1);assert.ok(paths[1].endsWith("/track/123"));
 returnedIsrc="USAT21602950";assert.equal((await provider.getByIsrc!(isrc.id)).length,0);
});

test("gateway If-Range resumes only its matching artifact identity",async()=>{
 const repo=new MemoryRepository(),ranges:Array<string|null>=[];const gateway=new RecordingAudioGateway(repo,{async open(_asset,range){ranges.push(range);return audioResponse(range);}});
 const head=await gateway.serve({...gatewayInput,method:"HEAD"});const etag=head.headers.get("ETag");assert.ok(etag);
 const resumed=await gateway.serve({...gatewayInput,range:"bytes=2-4",ifRange:etag});assert.equal(resumed.status,206);assert.equal(await resumed.text(),"234");
 const replaced=await gateway.serve({...gatewayInput,range:"bytes=2-4",ifRange:'"another-artifact"'});assert.equal(replaced.status,200);assert.equal(await replaced.text(),"0123456789");assert.deepEqual(ranges,["bytes=2-4",null]);
});

test("parallel worker ranges share immutable-document validation and bind every transfer",async()=>{
 let inspections=0;const transferHeaders:Headers[]=[];const worker={...source,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary",protocol:"v2" as const,documentId:"123456789"}};
 const expectedTag='"'+createHash("sha256").update(JSON.stringify(["primary","42","123456789",10,"audio/mpeg"])).digest("hex")+'"';
 const transport=new SourceAudioTransport({allowedCdnOrigins:[],worker:{url:"https://worker.example.test",secret:"secret",chatScope:"primary"}},(async(url,init)=>{
  if(String(url).endsWith("/audio-info")){inspections++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({fileId:"123456789",size:10,mimeType:"audio/mpeg",metadata:canonical.metadata});}
  const headers=new Headers(init?.headers);transferHeaders.push(headers);return audioResponse(headers.get("Range"));
 })as typeof fetch);
 const responses=await Promise.all([transport.open(worker,"bytes=0-2"),transport.open(worker,"bytes=3-5"),transport.open(worker,null)]);
 assert.equal(inspections,1);assert.deepEqual(await Promise.all(responses.map(response=>response.text())),["012","345","0123456789"]);
 assert.equal(transferHeaders[0].get("If-Range"),expectedTag);assert.equal(transferHeaders[1].get("If-Range"),expectedTag);assert.ok(transferHeaders.every(headers=>headers.get("If-Match")===expectedTag));
 await assert.rejects(transport.open({...worker,locator:{...worker.locator,documentId:"different"}},null),/document has changed/);
});

test("stored worker document identity survives repository decoding",async()=>{
 const row={id:assetId,recordingId,metadata:canonical.metadata,references:[{provider:"telegram",scope:"primary",id:"42"}],locator:{kind:"telegram-worker",messageId:"42",chatScope:"primary",protocol:"v2",documentId:"123456789"},state:"ready",verifiedAt:source.verifiedAt,mimeType:"audio/mpeg",sizeBytes:10,ownerAccountId:null};
 const repo=new PostgresRecordingRepository((async()=>[row])as ReadonlySql);const loaded=await repo.findAudio(recordingId,assetId,accountId);
 assert.deepEqual(loaded?.locator,row.locator);
});

test("a truncated source is a connection failure and cancellation stops full-file verification promptly",async()=>{
 await assert.rejects(completeAudio(new Response("short",{headers:{"Content-Type":"audio/mpeg"}}),10),(error:unknown)=>error instanceof AudioPromotionError&&error.reason==="provider");
 let canceled=false;const controller=new AbortController();const pending=completeAudio(new Response(new ReadableStream<Uint8Array>({start(stream){stream.enqueue(new Uint8Array([1]));},cancel(){canceled=true;}}),{headers:{"Content-Type":"audio/mpeg"}}),10,controller.signal);
 controller.abort();await assert.rejects(pending,{name:"AbortError"});assert.equal(canceled,true);
});

test("full-file hashing is available without a configured CDN publisher",async()=>{
 const saved:StoredAudioAsset[]=[];class Ingestor extends RecordingIngestor{override async persistAudio(_recording:CanonicalRecording,asset:StoredAudioAsset){saved.push(asset);}}
 const bytes=waveAudio(),worker={...source,sizeBytes:bytes.length,mimeType:"audio/wav",locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const promotions=new AudioPromotions({async open(){return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"audio/wav"}});}},new Ingestor(ingestionDatabase().transaction,[]));
 assert.equal(promotions.needsPreparation(worker),true);const checked=await promotions.prepare(canonical,worker);
 assert.equal(checked.sha256,createHash("sha256").update(bytes).digest("hex"));assert.equal(checked.assetId,worker.assetId);assert.equal(saved.length,1);assert.equal(promotions.needsPreparation(checked),false);
});

test("stored source mismatch triggers a fresh discovery job while catalog mismatch stays explicit",async()=>{
 const repo=new MemoryRepository();let enqueued=0;
 const jobs={async needsPreparation(){return false;},decoratePreparation(result:unknown){return result;},async enqueue(recording:CanonicalRecording){enqueued++;return{status:"pending" as const,jobId:assetId,recording,pollUrl:"/api/v2/recordings/jobs/"+assetId,retryAfterMs:1000};}} as unknown as AudioResolutionJobs;
 const resolver=new ProductionRecordingResolver(repo,new RecordingIngestor(ingestionDatabase().transaction,[]),new RecordingResolver(repo,[]),jobs);
 repo.assets=[{...source,candidate:{...source.candidate,metadata:{...canonical.metadata,title:"Finesse (Remix)",durationMs:217000}}}];
 assert.equal((await resolver.resolve({reference},accountId)).status,"pending");assert.equal(enqueued,1);
 assert.equal((await resolver.resolve({reference,expected:{...canonical.metadata,title:"Another Song"}},accountId)).status,"review");assert.equal(enqueued,1);
});

const localizedReference:ProviderReference={provider:"spotify",id:"1fPkUiufkRpzdYcBKXUP3s"};
const localizedMetadata={title:"咆哮 - HOKO",artists:["TOMONARI SORA"],durationMs:209766,artistsComplete:true} as const;
const nativeMetadata={title:"HOKO",artists:["友成空"],durationMs:209000,artistsComplete:true} as const;
const localizedIsrc:ProviderReference={provider:"isrc",id:"JPB602501985"};
const localizedRecording:CanonicalRecording={recordingId,metadata:localizedMetadata,references:[localizedReference,localizedIsrc]};
const nativeCatalog:CatalogRecording={reference:{provider:"deezer",id:"3559573421"},references:[{provider:"deezer",id:"3559573421"},localizedIsrc],metadata:nativeMetadata};

test("trusted native metadata proof survives storage while public callers cannot inject aliases",()=>{
 const metadata=withVerifiedCatalogAliases(localizedRecording,[nativeCatalog]);assert.equal(metadata.verifiedAliases?.length,1);
 assert.equal(parseRecordingMetadata(metadata).verifiedAliases,undefined);
 assert.equal(parseResolveInput({reference:localizedReference,expected:metadata}).expected?.verifiedAliases,undefined);
 assert.deepEqual(parseTrustedRecordingMetadata(metadata).verifiedAliases,metadata.verifiedAliases);
 assert.equal(assessAudioCandidate({...localizedRecording,metadata},{candidateId:"native",metadata:nativeMetadata,audioKind:"full"}).acceptable,true);
});

test("native source recovery retries an older v2 worker with a whole authoritative alias",async()=>{
 const requests:Array<Record<string,unknown>>=[];
 const provider:CatalogProvider={provider:"deezer",async getExact(){return nativeCatalog;},async getByIsrc(){return[nativeCatalog];}};
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(_url,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request);
  if(request.metadata.title===localizedMetadata.title)return Response.json({status:"review",candidates:[{title:nativeMetadata.title,artists:nativeMetadata.artists,durationMs:209000,reasons:["title","artist"]}]});
  return Response.json({status:"ready",audio:{messageId:"42",chatScope:"primary",fileId:"123456",metadata:nativeMetadata,size:5000,mimeType:"audio/mpeg"}});
 })as typeof fetch,[provider]);
 const result=await discovery.discover(localizedRecording);assert.equal(result.status,"ready");assert.equal(requests.length,2);
 assert.deepEqual(requests[1].reference,localizedReference);assert.deepEqual(requests[1].metadata,parseRecordingMetadata(nativeMetadata));
 assert.ok((requests[1].references as ProviderReference[]).some(ref=>ref.provider==="isrc"&&ref.id===localizedIsrc.id));
 if(result.status==="ready"){assert.ok(result.verifiedMetadata?.verifiedAliases?.length);assert.equal(result.asset.recordingId,recordingId);}
});

test("production discovery reaches native tags before a slower localized title exhausts its deadline",async(context)=>{
 const singleMetadata={...localizedMetadata,title:"咆哮",durationMs:209398};
 const singleReference:ProviderReference={provider:"spotify",id:"7rc79XVkUIvmK4TINjXhl1"};
 const selected:CanonicalRecording={...localizedRecording,metadata:withVerifiedCatalogAliases({metadata:singleMetadata,references:[singleReference,localizedIsrc]},[{reference:localizedReference,references:[localizedReference,localizedIsrc],metadata:localizedMetadata}]),references:[localizedReference,localizedIsrc,singleReference]};
 const controller=new AbortController(),startedAt=Date.now();let elapsed=0,lookups=0;
 context.mock.method(Date,"now",()=>startedAt+elapsed);
 const advance=(milliseconds:number)=>{elapsed+=milliseconds;if(elapsed>=50000)controller.abort(new DOMException("The discovery job timed out","TimeoutError"));controller.signal.throwIfAborted();};
 const provider:CatalogProvider={provider:"deezer",async getExact(){return nativeCatalog;},async getByIsrc(){lookups++;advance(12937);return[nativeCatalog];}};
 const requests:string[]=[];
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(_url,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request.metadata.title);
  if(request.metadata.title===singleMetadata.title){advance(25409);return Response.json({status:"review",candidates:[{title:nativeMetadata.title,artists:nativeMetadata.artists,durationMs:209000,reasons:["title","artist"]}]});}
  if(request.metadata.title!==nativeMetadata.title){advance(12100);return Response.json({status:"unavailable"},{status:409});}
  advance(2527);return Response.json({status:"ready",audio:{messageId:"42",chatScope:"primary",fileId:"123456",metadata:nativeMetadata,size:5000,mimeType:"audio/mpeg"}});
 })as typeof fetch,[provider]);
 const result=await discovery.discover(selected,controller.signal);
 assert.equal(result.status,"ready");assert.deepEqual(requests,[singleMetadata.title,nativeMetadata.title]);assert.equal(lookups,1);assert.equal(elapsed,40873);assert.equal(controller.signal.aborted,false);
});

test("persisted native recording proof recovers without waiting on unavailable catalogue services",async()=>{
 const selected={...localizedRecording,metadata:withVerifiedCatalogAliases(localizedRecording,[nativeCatalog])};let lookups=0;
 const provider:CatalogProvider={provider:"deezer",async getExact(){return null;},async getByIsrc(){lookups++;throw new Error("Catalogue is temporarily unavailable");}};
 const requests:string[]=[];
 const discovery=new WorkerAudioDiscovery({url:"https://worker.example.test",secret:"secret",primaryBot:"primary"},(async(_url,init)=>{
  const request=JSON.parse(String(init?.body));requests.push(request.metadata.title);
  return request.metadata.title===localizedMetadata.title?Response.json({status:"review",candidates:[]}):Response.json({status:"ready",audio:{messageId:"42",chatScope:"primary",metadata:nativeMetadata,size:5000,mimeType:"audio/mpeg"}});
 })as typeof fetch,[provider]);
 assert.equal((await discovery.discover(selected)).status,"ready");assert.deepEqual(requests,[localizedMetadata.title,nativeMetadata.title]);assert.equal(lookups,0);
});

test("aliases bind complete same-ISRC provider rows while wrong variants and identifiers remain rejected",async()=>{
 const provider:CatalogProvider={provider:"spotify",async getExact(){return null;},async getByIsrc(){return[
  nativeCatalog,{...nativeCatalog,metadata:{...nativeMetadata,title:"HOKO (Instrumental)"}},
  {...nativeCatalog,references:[nativeCatalog.reference,{provider:"isrc",id:"JPB602501986"}]},
  {...nativeCatalog,metadata:{...nativeMetadata,artists:["友成空","Unrelated Guest"]}},
 ];}};
 const hydrated=await new CatalogMetadataAliases([provider]).hydrate(localizedRecording);
 assert.equal(hydrated.metadata.verifiedAliases?.length,1);assert.deepEqual(hydrated.metadata.verifiedAliases?.[0].metadata,parseRecordingMetadata(nativeMetadata));
 for(const metadata of [{...nativeMetadata,title:"HOKO (Instrumental)"},{...nativeMetadata,durationMs:240000},{...nativeMetadata,artists:["Another Singer"]}])assert.equal(assessAudioCandidate(hydrated,{candidateId:"wrong",metadata,audioKind:"full"}).acceptable,false);
});

test("localized reindex retains canonical UUID and both actual provider proofs",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const original=await ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference,localizedIsrc],metadata:localizedMetadata});
 const native=await ingestor.ensureCatalog(nativeCatalog);assert.equal(original.recordingId,native.recordingId);assert.equal(database.records.size,1);
 const saved=database.records.get(native.recordingId)!;assert.ok(saved.verifiedAliases);
 assert.equal(assessAudioCandidate({metadata:parseTrustedRecordingMetadata(saved),references:[nativeCatalog.reference,localizedIsrc]},{candidateId:"old",metadata:localizedMetadata,audioKind:"full"}).acceptable,true);
});

test("reused exact provider ID with a different authoritative ISRC never fabricates alias proof",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const original=await ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference,localizedIsrc],metadata:localizedMetadata});
 await assert.rejects(ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference,{provider:"isrc",id:"JPB602501986"}],metadata:nativeMetadata}),RecordingIdentityConflict);
 assert.equal(database.records.get(original.recordingId)?.title,localizedMetadata.title);assert.equal(database.aliases.size,2);
});

test("cached locale aliases validate expected display metadata from the trusted recording side",async()=>{
 const repo=new MemoryRepository();const metadata=withVerifiedCatalogAliases(localizedRecording,[nativeCatalog]);
 repo.records=[{...localizedRecording,metadata}];repo.aliases.clear();repo.aliases.set(referenceKey(localizedReference),repo.records[0]);
 repo.assets=[{...source,candidate:{...source.candidate,metadata:nativeMetadata,references:[localizedIsrc]},recordingId}];
 const resolver=new RecordingResolver(repo,[]);
 assert.equal((await resolver.resolve({reference:localizedReference,expected:nativeMetadata},accountId)).status,"resolved");
 assert.equal((await resolver.resolve({reference:localizedReference,expected:{...nativeMetadata,title:"Another Track"}},accountId)).status,"review");
});

test("reindex preserves earlier complete aliases and rejects incremental duration drift",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const first=await ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference,localizedIsrc],metadata:localizedMetadata});
 await ingestor.ensureCatalog(nativeCatalog);
 const third:CatalogRecording={reference:{provider:"spotify",id:"7rc79XVkUIvmK4TINjXhl1"},references:[{provider:"spotify",id:"7rc79XVkUIvmK4TINjXhl1"},localizedIsrc],metadata:{...localizedMetadata,title:"咆哮",durationMs:209398}};
 await ingestor.ensureCatalog(third);const metadata=parseTrustedRecordingMetadata(database.records.get(first.recordingId));
 const request={metadata,references:third.references};
 assert.equal(assessAudioCandidate(request,{candidateId:"single",metadata:localizedMetadata,audioKind:"full"}).acceptable,true);
 assert.equal(assessAudioCandidate(request,{candidateId:"native",metadata:nativeMetadata,audioKind:"full"}).acceptable,true);
 assert.equal(assessAudioCandidate(request,{candidateId:"drift",metadata:{...nativeMetadata,durationMs:216000},audioKind:"full"}).acceptable,false);
 assert.equal(withVerifiedCatalogAliases(request,[]),metadata);
});

test("resolver read hydrates a cached canonical UUID before starting another source search",async()=>{
 const repo=new MemoryRepository();repo.records=[localizedRecording];repo.aliases.clear();repo.aliases.set(referenceKey(localizedReference),localizedRecording);
 repo.assets=[{...source,candidate:{...source.candidate,metadata:nativeMetadata,references:[localizedIsrc]}}];
 let lookups=0,persisted=0,enqueued=0;const provider:CatalogProvider={provider:"deezer",async getExact(){return nativeCatalog;},async getByIsrc(){lookups++;return[nativeCatalog];}};
 class Ingestor extends RecordingIngestor{override async persistVerifiedAliases(recording:CanonicalRecording){persisted++;repo.records=[recording];repo.aliases.set(referenceKey(localizedReference),recording);}}
 const jobs={async needsPreparation(){return false;},decoratePreparation(result:unknown){return result;},async enqueue(){enqueued++;throw new Error("A matching cached source must stay usable");}} as unknown as AudioResolutionJobs;
 const resolver=new ProductionRecordingResolver(repo,new Ingestor(ingestionDatabase().transaction,[provider]),new RecordingResolver(repo,[]),jobs);
 assert.equal((await resolver.resolve({reference:localizedReference},accountId)).status,"resolved");assert.equal(lookups,1);assert.equal(persisted,1);assert.equal(enqueued,0);
 assert.equal((await resolver.resolve({reference:localizedReference,expected:nativeMetadata},accountId)).status,"resolved");assert.equal(lookups,1);assert.equal(persisted,1);
});

test("stored native proof authorizes gateway delivery while wrong versions remain blocked",async()=>{
 const repo=new MemoryRepository();const metadata=parseTrustedRecordingMetadata(withVerifiedCatalogAliases(localizedRecording,[nativeCatalog]));repo.records=[{...localizedRecording,metadata}];
 repo.assets=[{...source,candidate:{...source.candidate,metadata:nativeMetadata,references:[{provider:"telegram",scope:"primary",id:"42"}]}}];
 const gateway=new RecordingAudioGateway(repo,{async open(){return audioResponse(null);}});
 assert.equal((await gateway.serve({...gatewayInput,method:"HEAD"})).status,200);
 repo.assets=[{...repo.assets[0],candidate:{...repo.assets[0].candidate,metadata:{...nativeMetadata,title:"HOKO (Karaoke)"}}}];
 assert.equal((await gateway.serve({...gatewayInput,method:"HEAD"})).status,409);
});

test("idempotent exact catalog reads retry one transient connection and never retry corrupt JSON",async()=>{
 const payload={id:123,title:"Finesse",duration:191,isrc:isrc.id,artist:{id:1,name:"Bruno Mars"},album:{id:1,title:"24K Magic"}};
 let calls=0;const provider=new DeezerCatalogProvider((async()=>{calls++;if(calls===1)throw new TypeError("Connection reset");return Response.json(payload);})as typeof fetch);
 assert.equal((await provider.getExact(reference))?.metadata.title,"Finesse");assert.equal(calls,2);
 calls=0;const corrupt=new DeezerCatalogProvider((async()=>{calls++;return new Response("not JSON");})as typeof fetch);
 await assert.rejects(corrupt.getExact(reference));assert.equal(calls,1);
 calls=0;const canceled=new AbortController();canceled.abort();await assert.rejects(provider.getExact(reference,canceled.signal),{name:"AbortError"});assert.equal(calls,0);
});

test("same exact provider row can update harmless localized spelling before ISRC is available",async()=>{
 const database=ingestionDatabase(),ingestor=new RecordingIngestor(database.transaction,[]);
 const first=await ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference],metadata:localizedMetadata});
 const second=await ingestor.ensureCatalog({reference:localizedReference,references:[localizedReference,localizedIsrc],metadata:nativeMetadata});
 assert.equal(first.recordingId,second.recordingId);assert.equal(database.records.size,1);
 const stored=parseTrustedRecordingMetadata(database.records.get(first.recordingId));
 assert.equal(assessAudioCandidate({metadata:stored,references:[localizedReference,localizedIsrc]},{candidateId:"old-spelling",metadata:localizedMetadata,audioKind:"full"}).acceptable,true);
});

const translatedIsrc:ProviderReference={provider:"isrc",id:"TWK970300503"};
const translatedRecording:CanonicalRecording={recordingId,metadata:{title:"晴天",artists:["Jay Chou"],durationMs:269746,artistsComplete:true},references:[{provider:"spotify",id:"5pIcwtJYNJx93l420oR2Vm"},translatedIsrc]};
const translatedCatalog:CatalogRecording={reference:{provider:"deezer",id:"2602471112"},references:[{provider:"deezer",id:"2602471112"},translatedIsrc],metadata:{title:"Sunny Day",artists:["Jay Chou"],durationMs:270000,artistsComplete:true},artistCredits:[{name:"Jay Chou",role:"primary",reference:{provider:"deezer",id:"69175"}}]};
const translatedArtistId="a223958d-5c56-4b2c-a30a-87e357bc121b";
function artistProofFetcher(change?:(kind:"url"|"artist",payload:Record<string,unknown>)=>Record<string,unknown>,calls:string[]=[]):typeof fetch{
 return(async(input)=>{
  const url=new URL(String(input));calls.push(url.toString());assert.equal(url.origin,"https://musicbrainz.org");
  const resource="https://www.deezer.com/artist/69175",kind=url.pathname==="/ws/2/url"?"url":"artist";
  const payload:Record<string,unknown>=kind==="url"?{resource,relations:[{"target-type":"artist",ended:false,artist:{id:translatedArtistId}}]}:{id:translatedArtistId,name:"周杰倫",aliases:[{name:"Jay Chou",primary:true,type:"Artist name",ended:false},{name:"Jay",primary:false,type:"Artist name"},{name:"Old credit",primary:true,type:"Artist name",ended:true}],relations:[{"target-type":"url",ended:false,url:{resource}}]};
  return Response.json(change?change(kind,payload):payload);
 })as typeof fetch;
}
function translatedProvider(row=translatedCatalog):CatalogProvider{return{provider:"deezer",async getExact(){return row;},async getByIsrc(){return[row];}};}

test("exact ISRC titles combine only with reciprocal catalogue artist identities",async()=>{
 const calls:string[]=[];const aliases=new CatalogMetadataAliases([translatedProvider()],new CatalogArtistAliases(artistProofFetcher(undefined,calls),0));
 const hydrated=await aliases.hydrate(translatedRecording);
 assert.equal(assessAudioCandidate(hydrated,{candidateId:"native",metadata:{title:"Sunny Day",artists:["周杰倫"],durationMs:269000},audioKind:"full"}).acceptable,true);
 assert.deepEqual(calls.map(url=>new URL(url).pathname),["/ws/2/url",`/ws/2/artist/${translatedArtistId}`]);
 assert.ok(hydrated.metadata.verifiedAliases?.some(alias=>alias.metadata.title==="Sunny Day"&&alias.metadata.artists[0]==="周杰倫"));
 assert.ok(hydrated.metadata.verifiedAliases?.every(alias=>alias.references.every(ref=>ref.provider!=="musicbrainz")));
 await aliases.hydrate(translatedRecording);assert.equal(calls.length,2);
 for(const metadata of [{title:"Sunny Day (Live)",artists:["周杰倫"],durationMs:269000},{title:"Sunny Day",artists:["Jay"],durationMs:269000},{title:"Sunny Day",artists:["周杰倫","Unrelated Guest"],durationMs:269000},{title:"Sunny Day",artists:["周杰倫"],durationMs:290000}])assert.equal(assessAudioCandidate(hydrated,{candidateId:"wrong",metadata,audioKind:"full"}).acceptable,false);
 assert.equal(assessAudioCandidate(hydrated,{candidateId:"preview",metadata:{title:"Sunny Day",artists:["周杰倫"],durationMs:269000},audioKind:"preview"}).acceptable,false);
 assert.equal(parseRecordingMetadata(hydrated.metadata).verifiedAliases,undefined);
});

test("artist aliases reject wrong resources, ambiguous identities and missing reciprocal proof",async()=>{
 const variants:((kind:"url"|"artist",payload:Record<string,unknown>)=>Record<string,unknown>)[]=[
  (kind,payload)=>kind==="url"?{...payload,resource:"https://www.deezer.com/artist/999"}:payload,
  (kind,payload)=>kind==="url"?{...payload,relations:[{"target-type":"artist",artist:{id:translatedArtistId}},{"target-type":"artist",artist:{id:otherId}}]}:payload,
  (kind,payload)=>kind==="url"?{...payload,relations:[{"target-type":"artist",artist:{id:"not-an-identity"}}]}:payload,
  (kind,payload)=>kind==="artist"?{...payload,id:otherId}:payload,
  (kind,payload)=>kind==="artist"?{...payload,relations:[]}:payload,
  (kind,payload)=>kind==="artist"?{...payload,aliases:[]}:payload,
  (kind,payload)=>kind==="artist"?{...payload,relations:[{"target-type":"url",ended:true,url:{resource:"https://www.deezer.com/artist/69175"}}]}:payload,
 ];
 for(const change of variants){
  const hydrated=await new CatalogMetadataAliases([translatedProvider()],new CatalogArtistAliases(artistProofFetcher(change),0)).hydrate(translatedRecording);
  assert.equal(assessAudioCandidate(hydrated,{candidateId:"native",metadata:{title:"Sunny Day",artists:["周杰倫"],durationMs:269000},audioKind:"full"}).acceptable,false);
 }
});

test("artist aliases preserve ordered credits and require a proved name for each replacement",async()=>{
 const row:CatalogRecording={...translatedCatalog,metadata:{...translatedCatalog.metadata,artists:["Jay Chou","Guest"]},artistCredits:[...translatedCatalog.artistCredits!,{name:"Guest",role:"featured"}]};
 const lookup=new CatalogArtistAliases(artistProofFetcher(),0),variants=await lookup.variants(row,AbortSignal.timeout(1000));
 assert.ok(variants.some(variant=>JSON.stringify(variant.metadata.artists)===JSON.stringify(["周杰倫","Guest"])));
 assert.ok(variants.every(variant=>variant.metadata.artists.length===2&&variant.metadata.artists[1]==="Guest"&&variant.artistCredits?.[1].role==="featured"));
 for(const invalid of [{...row,artistCredits:row.artistCredits!.slice(0,1)},{...row,artistCredits:[{...row.artistCredits![0],name:"Wrong performer"},row.artistCredits![1]]},{...row,artistCredits:[{...row.artistCredits![0],role:"featured" as const},row.artistCredits![1]]},{...row,metadata:{...row.metadata,artistsComplete:false}}])assert.deepEqual(await lookup.variants(invalid,AbortSignal.timeout(1000)),[]);
});

test("artist metadata transport failures retry independently of cached exact recording rows",async()=>{
 let lookups=0,requests=0;const valid=artistProofFetcher();
 const provider={...translatedProvider(),async getByIsrc(){lookups++;return[translatedCatalog];}};
 const lookup=new CatalogMetadataAliases([provider],new CatalogArtistAliases((async(input,init)=>{requests++;return requests===1?new Response(null,{status:503}):valid(input,init);})as typeof fetch,0));
 const before=await lookup.hydrate(translatedRecording);assert.equal(before.metadata.verifiedAliases?.some(alias=>alias.metadata.artists[0]==="周杰倫"),false);
 const after=await lookup.hydrate(translatedRecording);assert.ok(after.metadata.verifiedAliases?.some(alias=>alias.metadata.artists[0]==="周杰倫"));assert.equal(lookups,1);assert.equal(requests,3);
});

test("wrong recording proofs and editions cannot initiate artist alias enrichment",async()=>{
 const calls:string[]=[];
 for(const row of [{...translatedCatalog,references:[translatedCatalog.reference,{provider:"isrc" as const,id:"TWK970300504"}]},{...translatedCatalog,metadata:{...translatedCatalog.metadata,title:"Sunny Day (Live)"}},{...translatedCatalog,metadata:{...translatedCatalog.metadata,durationMs:350000}}]){
  const hydrated=await new CatalogMetadataAliases([translatedProvider(row)],new CatalogArtistAliases(artistProofFetcher(undefined,calls),0)).hydrate(translatedRecording);
  assert.equal(hydrated.metadata.verifiedAliases,undefined);
 }
 assert.equal(calls.length,0);
});

test("caller cancellation escapes artist hydration without publishing late alias proof",async()=>{
 const controller=new AbortController();let requests=0;
 const lookup=new CatalogMetadataAliases([translatedProvider()],new CatalogArtistAliases((async(_input,init)=>{
  requests++;controller.abort();init?.signal?.throwIfAborted();throw new Error("unreachable");
 })as typeof fetch,0));
 await assert.rejects(lookup.hydrate(translatedRecording,controller.signal),{name:"AbortError"});assert.equal(requests,1);assert.equal(translatedRecording.metadata.verifiedAliases,undefined);
});

test("queued artist requests cancel promptly without overtaking the preceding public request",async()=>{
 let release!:()=>void,started!:()=>void;const startedPromise=new Promise<void>(resolve=>{started=resolve;});
 const holding=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 const fetcher=(async(input,init)=>{requests++;if(requests===1){started();await holding;}return artistProofFetcher()(input,init);})as typeof fetch;
 const lookup=new CatalogArtistAliases(fetcher,1),credit=translatedCatalog.artistCredits![0],first=lookup.forCredit(credit,AbortSignal.timeout(1000));
 await startedPromise;const canceled=new AbortController(),second=lookup.forCredit(credit,canceled.signal);canceled.abort();
 await assert.rejects(second,{name:"AbortError"});assert.equal(requests,1);
 const third=lookup.forCredit(credit,AbortSignal.timeout(1000));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(requests,1);
 release();assert.ok((await first).includes("周杰倫"));assert.ok((await third).includes("周杰倫"));
});

test("late artist headers and bodies cannot publish or cache proof after cancellation",async()=>{
 for(const phase of ["headers","body"]){
  const canceled=new AbortController();let requests=0;const valid=artistProofFetcher();
  const lookup=new CatalogArtistAliases((async(input,init)=>{
   requests++;const response=await valid(input,init);
   if(requests===2){
    if(phase==="headers"){canceled.abort();return response;}
    const bytes=new TextEncoder().encode(await response.text());
    return new Response(new ReadableStream({pull(controller){canceled.abort();controller.enqueue(bytes);controller.close();}},{highWaterMark:0}),{headers:{"Content-Type":"application/json"}});
   }
   return response;
  })as typeof fetch,0);
  const credit=translatedCatalog.artistCredits![0];await assert.rejects(lookup.forCredit(credit,canceled.signal),{name:"AbortError"});assert.equal(requests,2);
  assert.ok((await lookup.forCredit(credit,AbortSignal.timeout(1000))).includes("周杰倫"));assert.equal(requests,4);
 }
});

test("artist identity lookup refuses redirected authority responses",async()=>{
 const lookup=new CatalogArtistAliases((async(_input,init)=>{
  assert.equal(init?.redirect,"error");const response=Response.json({resource:"https://www.deezer.com/artist/69175",relations:[{"target-type":"artist",artist:{id:translatedArtistId}}]});
  Object.defineProperty(response,"redirected",{value:true});return response;
 })as typeof fetch,0);
 assert.deepEqual(await lookup.forCredit(translatedCatalog.artistCredits![0],AbortSignal.timeout(1000)),["Jay Chou"]);
});
