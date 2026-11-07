import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceKey } from "../core/identity";
import type { CanonicalRecording, ProviderReference } from "../core/types";
import { parseResolveInput, readResolveInput } from "./input";
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
import {createHash} from "node:crypto";

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

function ingestionDatabase(){
 const records=new Map<string,Record<string,unknown>>(),aliases=new Map<string,string>();
 const artists=new Map<string,{id:string;name:string}>(),credits=new Map<string,{artistId:string;position:number}[]>();
 const query:ReadonlySql=async<Row>(statement:string,args:readonly unknown[])=>{
  let rows:unknown[]=[];
  if(statement.includes("JOIN sakura_v2.\"Recording\"")){const id=aliases.get(JSON.stringify(args.slice(0,3)));if(id)rows=[{id,metadata:records.get(id)}];}
  else if(statement.startsWith('INSERT INTO sakura_v2."Recording"'))records.set(String(args[0]),JSON.parse(String(args[1])));
  else if(statement.startsWith('UPDATE sakura_v2."Recording"'))records.set(String(args[0]),{...records.get(String(args[0])),...JSON.parse(String(args[1]))});
  else if(statement.startsWith('INSERT INTO sakura_v2."ExternalReference"')){const key=JSON.stringify(args.slice(0,3));if(!aliases.has(key))aliases.set(key,String(args[3]));}
  else if(statement.startsWith("SELECT recording_id")){const id=aliases.get(JSON.stringify(args.slice(0,3)));if(id)rows=[{recording_id:id}];}
  else if(statement.startsWith('INSERT INTO sakura_v2."Artist"')){const key=JSON.stringify(args.slice(0,2)),id=artists.get(key)?.id??`55555555-5555-4555-8555-${String(artists.size+1).padStart(12,"0")}`;artists.set(key,{id,name:String(args[2])});rows=[{id}];}
  else if(statement.startsWith('INSERT INTO sakura_v2."RecordingArtist"')){const id=String(args[0]),next=(credits.get(id)??[]).filter(credit=>credit.artistId!==args[1]);credits.set(id,[...next,{artistId:String(args[1]),position:Number(args[2])}]);}
  else if(statement.startsWith('DELETE FROM sakura_v2."RecordingArtist"')){const id=String(args[0]),kept=args[1]as string[];credits.set(id,(credits.get(id)??[]).filter(credit=>kept.includes(credit.artistId)));}
  return rows as Row[];
 };
 const transaction:SqlTransaction=async operation=>operation(query);
 return{records,aliases,artists,credits,transaction};
}

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
 const bytes=Buffer.from("0123456789"),sha256=createHash("sha256").update(bytes).digest("hex"),saved:StoredAudioAsset[]=[];let opens=0,publishes=0;
 class Ingestor extends RecordingIngestor{override async persistAudio(recording:CanonicalRecording,asset:StoredAudioAsset){assert.equal(recording.recordingId,recordingId);saved.push(asset);}}
 const ingestor=new Ingestor(ingestionDatabase().transaction,[]),promotions=new AudioPromotions({async open(){opens++;await new Promise(resolve=>setTimeout(resolve,10));return audioResponse(null);}},ingestor,{async publish(_recording,asset){publishes++;assert.equal(asset.sha256,sha256);return{...asset,locator:{kind:"https",url:"https://cdn.example.test/audio.mp3"}};}});
 const worker={...source,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};
 const first=promotions.prepare(canonical,worker),second=promotions.prepare(canonical,worker);assert.equal(first,second);const result=await first;assert.equal(opens,1);assert.equal(publishes,1);assert.equal(saved.length,2);assert.equal(result.recordingId,recordingId);assert.equal(result.sha256,sha256);
});

test("ready-worker preparation jobs produce CDN or explicit quota fallback and refuse integrity failure",async()=>{
 for(const outcome of ["ready","quota","integrity"] as const){
  const repo=new MemoryRepository(),sha256=createHash("sha256").update("0123456789").digest("hex");
  const worker={...source,sha256,locator:{kind:"telegram-worker" as const,messageId:"42",chatScope:"primary"}};repo.assets=[worker];
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
  const promotions=new AudioPromotions({async open(){return audioResponse(null);}},ingestor,{async publish(_recording,asset){publications++;if(outcome!=="ready")throw new AudioPromotionError(outcome,"Preparation failed");return{...asset,assetId:otherId,candidate:{...asset.candidate,candidateId:otherId},locator:{kind:"https",url:"https://cdn.example.test/verified.mp3"}};}});
  const resolver=new RecordingResolver(repo,[],asset=>asset.locator.kind==="https"?asset.locator.url:undefined);
  const jobs=new AudioResolutionJobs(query,repo,ingestor,{async discover(){discoveries++;throw new Error("An existing exact source must not start another bot search");}},resolver,undefined,promotions);
  assert.equal(await jobs.needsPreparation(await resolver.resolve({reference},accountId),accountId),true);
  const pending=await jobs.enqueue(canonical,accountId,"preparing-audio");assert.equal(pending.status,"pending");if(pending.status!=="pending")throw new Error("Expected preparation job");assert.equal(pending.stage,"preparing-audio");
  await jobs.process(pending.jobId);const result=await jobs.get(pending.jobId,accountId);assert.equal(publications,1);assert.equal(discoveries,0);
  if(outcome==="integrity"){assert.equal(result?.status,"review");assert.equal(row.state,"review");}
  else{assert.equal(result?.status,"resolved");if(result?.status!=="resolved")throw new Error("Expected validated playback");assert.equal(result.playback.sha256,sha256);assert.equal(result.recording.recordingId,recordingId);assert.equal(result.playback.delivery,outcome==="ready"?"cdn":"worker-fallback");assert.equal(result.playback.preparationFailure,outcome==="quota"?"quota":undefined);}
  assert.ok(repo.assets.some(a=>a.locator.kind==="telegram-worker"&&a.sha256===sha256),"Verified worker fallback must remain stored");
 }
});
