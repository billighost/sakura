import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMetadataText, normalizedRecording, parseRecordingTitle, RecordingAliases, referenceKey } from "./identity";
import { assessAudioCandidate, selectAudioCandidate, verifiedRecordingAliases } from "./matching";
import { downloadKey, downloadProgress, downloadedRecordings, reduceDownloads, type DownloadState } from "./downloads";
import { EMPTY_QUEUE, isQueueEntryPlaying, reduceQueue } from "./queue";
import { fetchAudioHeaders, parseByteRange, planPlayback } from "./streaming";
import type { AudioCandidate, RecordingRequest } from "./types";

const finesse: RecordingRequest = { metadata: { title: "Finesse", artists: ["Bruno Mars"], durationMs: 191000 } };
const original: AudioCandidate = { ...finesse, candidateId: "original", audioKind: "full", bitrateKbps: 128 };
const remix: AudioCandidate = { candidateId: "remix", metadata: { title: "Finesse (Remix) [feat. Cardi B]", artists: ["Bruno Mars"], durationMs: 217000 }, audioKind: "full", bitrateKbps: 320 };
const scope = { accountId: "listener-a", deviceId: "phone" };

test("Unicode names retain identity and presentation forms normalize", () => {
  assert.equal(normalizeMetadataText("Ｙｅ — Burna  Boy"), "ye burna boy");
  assert.notEqual(normalizeMetadataText("夜に駆ける"), normalizeMetadataText("群青"));
  assert.equal(normalizeMetadataText("宇多田ヒカル"), "宇多田ヒカル");
  assert.equal(normalizeMetadataText("Beyoncé"), normalizeMetadataText("Beyonce\u0301"));
});

test("version and featured credits remain significant, ordinary parentheses remain in title", () => {
  assert.deepEqual(parseRecordingTitle("Finesse"), { base: "finesse", version: { kinds: [], labels: [] }, featuredArtists: [] });
  const parsed = parseRecordingTitle("Finesse (Remix) [feat. Cardi B]");
  assert.equal(parsed.base, "finesse");
  assert.deepEqual(parsed.version, { kinds: ["remix"], labels: ["remix"] });
  assert.deepEqual(parsed.featuredArtists, ["Cardi B"]);
  assert.equal(parseRecordingTitle("Sweet Dreams (Are Made of This)").base, "sweet dreams are made of this");
  assert.equal(parseRecordingTitle("Song - Acoustic").version.kinds[0], "acoustic");
  assert.equal(parseRecordingTitle("Song (2012 Remaster)").version.labels[0], "2012 remaster");
});

test("compound remix and feature tags match separate tags while named remix and original remain distinct",()=>{
 const selected={metadata:{title:"Finesse (Remix; feat. Cardi B)",artists:["Bruno Mars","Cardi B"],durationMs:217000,version:{kinds:["remix" as const],labels:["remix feat cardi b"]}}};
 const delivered={candidateId:"remix",audioKind:"full" as const,metadata:{title:"Finesse (Remix; feat. Cardi B)",artists:["Bruno Mars"],durationMs:217000}};
 assert.equal(assessAudioCandidate(selected,delivered).acceptable,true);
 assert.deepEqual(parseRecordingTitle("Finesse (Remix; feat. Cardi B)").featuredArtists,["Cardi B"]);
 assert.deepEqual(parseRecordingTitle("Song (Remix; feat. Guest; 2018 Remaster)").version,{kinds:["remaster","remix"],labels:["2018 remaster","remix"]});
 assert.equal(assessAudioCandidate(finesse,delivered).acceptable,false);
 assert.equal(assessAudioCandidate(selected,{...delivered,metadata:{...delivered.metadata,title:"Finesse (Pink Panda Remix; feat. Cardi B)"}}).acceptable,false);
 assert.equal(assessAudioCandidate(selected,{...delivered,metadata:{...delivered.metadata,title:"Finesse (Remix; feat. Wrong Guest)"}}).acceptable,false);
});

test("incomplete display credits hydrate exact catalog credits without weakening complete source verification",()=>{
 const partial={metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk]"],artistsComplete:false,durationMs:199000}};
 const exact={candidateId:"exact",audioKind:"full" as const,metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Rei"],artistsComplete:true,durationMs:199486}};
 assert.equal(assessAudioCandidate(partial,exact).acceptable,true);
 assert.equal(assessAudioCandidate({metadata:exact.metadata},{...exact,metadata:partial.metadata}).acceptable,true);
 assert.equal(assessAudioCandidate({metadata:exact.metadata},{...exact,metadata:{...partial.metadata,artistsComplete:undefined}}).acceptable,false);
 assert.equal(assessAudioCandidate(partial,{...exact,metadata:{...exact.metadata,artists:["Wrong Primary","Rei"]}}).acceptable,false);
 assert.equal(assessAudioCandidate({...partial,metadata:{...partial.metadata,artists:["SawanoHiroyuki[nZk]","Wrong Guest"]}},exact).acceptable,false);
 assert.equal(assessAudioCandidate({metadata:exact.metadata},{...exact,metadata:{...partial.metadata,artists:["SawanoHiroyuki[nZk]","Wrong Guest"]}}).acceptable,false);
});

test("an explicitly incomplete source may omit a featured credit but not contradict it",()=>{
 const work={metadata:{title:"Work",artists:["Rihanna","Drake"],artistsComplete:true,durationMs:219000}};
 const primaryOnly={candidateId:"work",audioKind:"full" as const,metadata:{title:"Work",artists:["Rihanna"],artistsComplete:false,durationMs:219000}};
 assert.equal(assessAudioCandidate(work,primaryOnly).acceptable,true);
 assert.ok(assessAudioCandidate(work,{...primaryOnly,metadata:{...primaryOnly.metadata,artists:["Rihanna","Wrong Guest"]}}).reasons.includes("artist"));
 assert.ok(assessAudioCandidate(work,{...primaryOnly,metadata:{...primaryOnly.metadata,title:"Work (Remix)"}}).reasons.includes("version"));
 assert.ok(assessAudioCandidate(work,{...primaryOnly,metadata:{...primaryOnly.metadata,durationMs:260000}}).reasons.includes("duration"));
});

test("combined performer fields expand only into the exact independently known credits", () => {
 const inertia = {metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk]","Rei"],durationMs:199486}};
 const audio = {candidateId:"inertia",audioKind:"full" as const,metadata:{title:"INERTIA",artists:["SawanoHiroyuki[nZk], REI"],durationMs:199000}};
 assert.equal(assessAudioCandidate(inertia,audio).acceptable,true);
 const remixRequest = {metadata:{title:"Finesse (Remix; feat. Cardi B)",artists:["Bruno Mars","Cardi B"],durationMs:217000}};
 const remixAudio = {candidateId:"remix",audioKind:"full" as const,metadata:{title:"Finesse (Remix; feat. Cardi B)",artists:["Bruno Mars; Cardi B"],durationMs:217289}};
 assert.equal(assessAudioCandidate(remixRequest,remixAudio).acceptable,true);
 assert.equal(assessAudioCandidate(finesse,remixAudio).acceptable,false);
 for(const performer of ["SawanoHiroyuki[nZk], Wrong Guest","SawanoHiroyuki[nZk]","REI, SawanoHiroyuki[nZk]","Wrong Primary, REI"]){
  assert.ok(assessAudioCandidate(inertia,{...audio,metadata:{...audio.metadata,artists:[performer]}}).reasons.includes("artist"));
 }
 assert.ok(assessAudioCandidate(inertia,{...audio,audioKind:"preview"}).reasons.includes("preview"));
 assert.ok(assessAudioCandidate(inertia,{...audio,metadata:{...audio.metadata,durationMs:300000}}).reasons.includes("duration"));
 assert.ok(assessAudioCandidate(remixRequest,{...remixAudio,metadata:{...remixAudio.metadata,title:"Finesse (Pink Panda Remix; feat. Cardi B)"}}).reasons.includes("version"));
});

test("contextual artist splitting preserves band names containing credit delimiters", () => {
 const selected = {metadata:{title:"Song",artists:["Earth, Wind & Fire","Guest"],durationMs:180000}};
 const candidate = {candidateId:"band",audioKind:"full" as const,metadata:{title:"Song",artists:["Earth, Wind & Fire; Guest"],durationMs:180000}};
 assert.equal(assessAudioCandidate(selected,candidate).acceptable,true);
 assert.equal(assessAudioCandidate({...selected,metadata:{...selected.metadata,artists:["Earth, Wind & Fire"]}},{...candidate,metadata:{...candidate.metadata,artists:["Earth, Wind & Fire"]}}).acceptable,true);
 assert.ok(assessAudioCandidate(selected,{...candidate,metadata:{...candidate.metadata,artists:["Earth, Wind & Fire; Wrong Guest"]}}).reasons.includes("artist"));
 // Context never mutates the raw metadata or creates durable artist aliases.
 assert.deepEqual(candidate.metadata.artists,["Earth, Wind & Fire; Guest"]);
 assert.deepEqual(normalizedRecording(candidate.metadata).artists,["earth wind fire guest"]);
});

test("alternate provider references resolve to one recording without metadata clones", () => {
  const aliases = new RecordingAliases();
  aliases.bind("recording-ye", [{ provider: "deezer", id: "123" }, { provider: "legacy", id: "ye-old-id" }]);
  aliases.bind("recording-ye", [{ provider: "deezer", id: "456" }, { provider: "spotify", id: "album-release" }]);
  assert.equal(aliases.resolve({ provider: "deezer", id: "123" }), aliases.resolve({ provider: "deezer", id: "456" }));
  assert.equal(aliases.entries().length, 4);
  assert.throws(() => aliases.bind("wrong-recording", [{ provider: "legacy", id: "new" }, { provider: "deezer", id: "123" }]));
  assert.equal(aliases.resolve({ provider: "legacy", id: "new" }), undefined, "binding conflicts roll back the entire batch");
});

test("provider alias scoping and conflicts cannot silently merge recordings", () => {
  const aliases = new RecordingAliases();
  assert.throws(() => referenceKey({ provider: "telegram", id: "42" }));
  assert.notEqual(referenceKey({ provider: "telegram", id: "42", scope: "chat-a" }), referenceKey({ provider: "telegram", id: "42", scope: "chat-b" }));
  assert.equal(referenceKey({ provider: "isrc", id: "US-AT2-16-02949" }), referenceKey({ provider: "isrc", id: "USAT21602949" }));
  aliases.bind("a", [{ provider: "deezer", id: "1" }]);
  aliases.bind("b", [{ provider: "spotify", id: "2" }]);
  assert.throws(() => aliases.resolveAll([{ provider: "deezer", id: "1" }, { provider: "spotify", id: "2" }]));
});

test("Finesse original never selects higher bitrate Cardi B remix", () => {
  const match = selectAudioCandidate(finesse, [remix, original]);
  assert.equal(match.status, "matched");
  if (match.status === "matched") assert.equal(match.candidate.candidateId, "original");
  const assessment = assessAudioCandidate(finesse, remix);
  assert.ok(assessment.reasons.includes("version"));
  assert.ok(assessment.reasons.includes("artist"));
  assert.equal(selectAudioCandidate(finesse, [remix]).status, "unavailable");
});

test("requested remix, live version and explicit edition require exact version evidence", () => {
  assert.equal(selectAudioCandidate(remix, [original, remix]).status, "matched");
  const live = { ...original, metadata: { ...original.metadata, title: "Finesse (Live)" } };
  assert.ok(assessAudioCandidate(finesse, live).reasons.includes("version"));
  assert.ok(assessAudioCandidate({ ...finesse, metadata: { ...finesse.metadata, explicit: "explicit" } }, { ...original, metadata: { ...original.metadata, explicit: "clean" } }).reasons.includes("explicit"));
});

test("title-only, artist-only and preview matches are refused", () => {
  const wrongArtist = { ...original, metadata: { ...original.metadata, artists: ["Pheelz"] } };
  const wrongTitle = { ...original, metadata: { ...original.metadata, title: "24K Magic" } };
  assert.ok(assessAudioCandidate(finesse, wrongArtist).reasons.includes("artist"));
  assert.ok(assessAudioCandidate(finesse, wrongTitle).reasons.includes("title"));
  assert.ok(assessAudioCandidate(finesse, { ...original, audioKind: "preview" }).reasons.includes("preview"));
  assert.ok(assessAudioCandidate(finesse, { ...original, audioKind: "unknown" }).reasons.includes("unverified-audio"));
});

test("duration missing or divergent cannot establish an automatic metadata match", () => {
  assert.ok(assessAudioCandidate(finesse, { ...original, metadata: { ...original.metadata, durationMs: 210000 } }).reasons.includes("duration"));
  assert.ok(assessAudioCandidate(finesse, { ...original, metadata: { ...original.metadata, durationMs: null } }).reasons.includes("missing-duration"));
  const ref = { provider: "isrc" as const, id: "USAT21602949" };
  assert.equal(assessAudioCandidate({ ...finesse, references: [ref] }, { ...original, references: [ref], metadata: { ...original.metadata, durationMs: null } }).acceptable, true);
});

test("conflicting authoritative IDs are rejected even when text agrees", () => {
  const wanted = { ...finesse, references: [{ provider: "isrc" as const, id: "USAT21602949" }] };
  const wrong = { ...original, references: [{ provider: "isrc" as const, id: "USAT21602950" }] };
  assert.ok(assessAudioCandidate(wanted, wrong).reasons.includes("identifier-conflict"));
});

test("unverified tied candidates prompt a version choice rather than selecting first", () => {
  assert.equal(selectAudioCandidate(finesse, [original, { ...original, candidateId: "other", bitrateKbps: 320 }]).status, "ambiguous");
  const ref = { provider: "isrc" as const, id: "USAT21602949" };
  const result = selectAudioCandidate(finesse, [{ ...original, references: [ref] }, { ...original, references: [ref], candidateId: "lossless", bitrateKbps: 320 }]);
  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.candidate.candidateId, "lossless");
});

test("one recording makes one download row across mix and search provider aliases", () => {
  const aliases = new RecordingAliases();
  aliases.bind("recording-ye", [{ provider: "deezer", id: "mix-release" }, { provider: "legacy", id: "search-result" }]);
  let state: DownloadState = {};
  state = reduceDownloads(state, { type: "enqueue", recordingId: aliases.resolve({ provider: "deezer", id: "mix-release" })!, scope });
  const same = reduceDownloads(state, { type: "enqueue", recordingId: aliases.resolve({ provider: "legacy", id: "search-result" })!, scope });
  assert.equal(same, state);
  assert.equal(Object.keys(same).length, 1);
});

test("download progress is honest and only a full validated artifact completes", () => {
  let state = reduceDownloads({}, { type: "enqueue", recordingId: "ye", scope });
  state = reduceDownloads(state, { type: "start", recordingId: "ye", scope, operationId: "attempt-1" });
  const key = downloadKey("ye", scope);
  assert.equal(downloadProgress(state[key]), null);
  state = reduceDownloads(state, { type: "progress", recordingId: "ye", scope, operationId: "attempt-1", downloadedBytes: 5, totalBytes: 10 });
  assert.equal(downloadProgress(state[key]), 0.5);
  const incomplete = reduceDownloads(state, { type: "complete", recordingId: "ye", scope, operationId: "attempt-1", artifactId: "file", sha256: "a".repeat(64), downloadedBytes: 9 });
  assert.equal(incomplete, state);
  state = reduceDownloads(state, { type: "complete", recordingId: "ye", scope, operationId: "attempt-1", artifactId: "file", sha256: "a".repeat(64), downloadedBytes: 10 });
  assert.equal(downloadedRecordings(state, scope).length, 1);
  assert.equal(downloadedRecordings(state, { ...scope, accountId: "other" }).length, 0);
  assert.equal(reduceDownloads(state, { type: "enqueue", recordingId: "ye", scope }), state);
});

test("paused transfer ignores previous attempt events and progresses monotonically", () => {
  let state = reduceDownloads({}, { type: "enqueue", recordingId: "ye", scope });
  state = reduceDownloads(state, { type: "start", recordingId: "ye", scope, operationId: "old" });
  state = reduceDownloads(state, { type: "progress", recordingId: "ye", scope, operationId: "old", downloadedBytes: 5, totalBytes: 10 });
  state = reduceDownloads(state, { type: "pause", recordingId: "ye", scope, operationId: "old" });
  state = reduceDownloads(state, { type: "start", recordingId: "ye", scope, operationId: "new" });
  assert.equal(reduceDownloads(state, { type: "complete", recordingId: "ye", scope, operationId: "old", artifactId: "bad", sha256: "a".repeat(64), downloadedBytes: 10 }), state);
  assert.equal(reduceDownloads(state, { type: "progress", recordingId: "ye", scope, operationId: "new", downloadedBytes: 4, totalBytes: 10 }), state);
});

test("duplicate song queue occurrences have independent playing states", () => {
  let state = reduceQueue(EMPTY_QUEUE, { type: "replace", entries: [{ entryId: "one", recordingId: "ye" }, { entryId: "two", recordingId: "ye" }] });
  state = reduceQueue(state, { type: "resolved", requestVersion: state.requestVersion });
  state = reduceQueue(state, { type: "playing", requestVersion: state.requestVersion });
  assert.equal(isQueueEntryPlaying(state, "one"), true);
  assert.equal(isQueueEntryPlaying(state, "two"), false);
  assert.throws(() => reduceQueue(state, { type: "append", entries: [{ entryId: "one", recordingId: "other" }] }));
});

test("late resolver and media callbacks cannot start a previously selected song", () => {
  let state = reduceQueue(EMPTY_QUEUE, { type: "replace", entries: [{ entryId: "a", recordingId: "first" }, { entryId: "b", recordingId: "second" }] });
  const old = state.requestVersion;
  state = reduceQueue(state, { type: "next" });
  assert.equal(reduceQueue(state, { type: "resolved", requestVersion: old }), state);
  assert.equal(reduceQueue(state, { type: "playing", requestVersion: old }), state);
  assert.equal(state.currentEntryId, "b");
  assert.equal(state.status, "resolving");
});

test("play-next, reorder and remove target occurrences while preserving active playback", () => {
  let state = reduceQueue(EMPTY_QUEUE, { type: "replace", entries: [{ entryId: "a", recordingId: "first" }, { entryId: "b", recordingId: "second" }] });
  state = reduceQueue(state, { type: "play-next", entries: [{ entryId: "c", recordingId: "third" }] });
  assert.deepEqual(state.entries.map((entry) => entry.entryId), ["a", "c", "b"]);
  const version = state.requestVersion;
  state = reduceQueue(state, { type: "move", entryId: "b", beforeEntryId: "a" });
  assert.equal(state.currentEntryId, "a");
  assert.equal(state.requestVersion, version);
  state = reduceQueue(state, { type: "remove", entryId: "a" });
  assert.equal(state.currentEntryId, "c");
  assert.equal(state.requestVersion, version + 1);
});

test("repeat-one only repeats on song end; manual next still skips", () => {
  let state = reduceQueue(EMPTY_QUEUE, { type: "replace", entries: [{ entryId: "a", recordingId: "first", durationMs: 10000 }, { entryId: "b", recordingId: "second" }] });
  state = reduceQueue(state, { type: "repeat", mode: "one" });
  assert.equal(reduceQueue(state, { type: "ended" }).currentEntryId, "a");
  assert.equal(reduceQueue(state, { type: "next" }).currentEntryId, "b");
  assert.equal(reduceQueue(state, { type: "seek", positionMs: 20000 }).positionMs, 10000);
});

test("repeat-all wraps; exhausted queue stays paused instead of claiming playback", () => {
  let state = reduceQueue(EMPTY_QUEUE, { type: "replace", entries: [{ entryId: "a", recordingId: "first" }] });
  assert.equal(reduceQueue(state, { type: "ended" }).status, "paused");
  state = reduceQueue(state, { type: "repeat", mode: "all" });
  assert.equal(reduceQueue(state, { type: "ended" }).status, "resolving");
});

test("byte range parser supports Safari suffix probes, valid bounds and unsatisfiable offsets", () => {
  assert.deepEqual(parseByteRange("bytes=-500", 1000), { status: "range", start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { status: "range", start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=0-9999", 1000), { status: "range", start: 0, end: 999 });
  assert.deepEqual(parseByteRange("bytes=1000-", 1000), { status: "unsatisfiable" });
  assert.deepEqual(parseByteRange("bytes=500-100", 1000), { status: "ignore" });
  assert.deepEqual(parseByteRange("bytes=0-1,4-5", 1000), { status: "ignore" });
  assert.deepEqual(parseByteRange(null, 1000), { status: "ignore" });
});

test("ready CDN and offline audio play directly; pending and previews stay explicit", () => {
  assert.deepEqual(planPlayback({ recordingId: "ye", kind: "full", state: "ready", url: "https://res.cloudinary.com/music/ye.mp3" }), { kind: "stream", url: "https://res.cloudinary.com/music/ye.mp3" });
  assert.deepEqual(planPlayback({ recordingId: "ye", kind: "full", state: "unavailable", offlineArtifactId: "local-ye" }), { kind: "offline", artifactId: "local-ye" });
  assert.deepEqual(planPlayback({ recordingId: "ye", kind: "full", state: "resolving" }), { kind: "resolve" });
  assert.deepEqual(planPlayback({ recordingId: "ye", kind: "preview", state: "ready", url: "https://example.com/preview" }), { kind: "unavailable", reason: "preview-only" });
  assert.equal(planPlayback({ recordingId: "ye", kind: "full", state: "ready", url: "pending" }).kind, "unavailable");
});

test("header deadline stops counting once headers arrive, body may continue afterwards", async () => {
  let requestSignal: AbortSignal | undefined;
  const fetcher = (async (_input: unknown, init: RequestInit) => {
    requestSignal = init.signal as AbortSignal;
    return new Response(new ReadableStream({ async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.enqueue(new TextEncoder().encode("audio"));
      controller.close();
    } }));
  }) as typeof fetch;
  const response = await fetchAudioHeaders("https://example.com/audio", { headerTimeoutMs: 10 }, fetcher);
  assert.equal(await response.text(), "audio");
  assert.equal(requestSignal?.aborted, false);
});

test("header deadline aborts a hung provider and caller cancellation remains active", async () => {
  const hung = (async (_input: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }))) as typeof fetch;
  await assert.rejects(fetchAudioHeaders("https://example.com/audio", { headerTimeoutMs: 10 }, hung), /Audio headers timed out/);
  let requestSignal: AbortSignal | undefined;
  const caller = new AbortController();
  const fetcher = (async (_input: unknown, init: RequestInit) => {
    requestSignal = init.signal as AbortSignal;
    return new Response(new ReadableStream({ start() {} }));
  }) as typeof fetch;
  const response = await fetchAudioHeaders("https://example.com/audio", { signal: caller.signal }, fetcher);
  caller.abort();
  assert.equal(requestSignal?.aborted, true);
  await response.body!.cancel();
});

test("normalization never invents absent duration or primary artist", () => {
  assert.equal(normalizedRecording({ title: "Song", artists: [], durationMs: Number.NaN }).durationMs, null);
  assert.ok(assessAudioCandidate({ metadata: { title: "Song", artists: [], durationMs: 10000 } }, { candidateId: "bad", metadata: { title: "Song", artists: [], durationMs: 10000 }, audioKind: "full" }).reasons.includes("missing-metadata"));
});

test("generic structured versions and localized labels agree without merging named versions",()=>{
 const request={metadata:{title:"夜に駆ける",artists:["YOASOBI"],durationMs:261000,version:{kinds:["remix" as const],labels:[]}}};
 const candidate={candidateId:"ja",audioKind:"full" as const,metadata:{title:"夜に駆ける (リミックス)",artists:["YOASOBI"],durationMs:261000}};
 assert.equal(assessAudioCandidate(request,candidate).acceptable,true);
 assert.ok(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,title:"夜に駆ける (Ayase Remix)"}}).reasons.includes("version"));
 assert.equal(assessAudioCandidate({...request,metadata:{...request.metadata,version:{kinds:["remix"],labels:["Ayase Remix"]}}},{...candidate,metadata:{...candidate.metadata,title:"夜に駆ける (Ayase リミックス)"}}).acceptable,true);
 assert.ok(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,title:"夜に駆ける"}}).reasons.includes("version"));
 assert.ok(assessAudioCandidate({...request,metadata:{...request.metadata,title:"群青"}},candidate).reasons.includes("title"));
 const remaster={metadata:{title:"Song (2012 Remaster)",artists:["Artist"],durationMs:180000}};
 const mastered={candidateId:"master",audioKind:"full" as const,metadata:{title:"Song (2012 Remastered)",artists:["Artist"],durationMs:180000}};
 assert.equal(assessAudioCandidate(remaster,mastered).acceptable,true);
 assert.ok(assessAudioCandidate(remaster,{...mastered,metadata:{...mastered.metadata,title:"Song (2013 Remastered)"}}).reasons.includes("version"));
});

function localizedFixture(title="咆哮 - HOKO",nativeTitle="HOKO",durationMs=209766):RecordingRequest{
 const proof={provider:"isrc" as const,id:"JPB602501985"};
 return {references:[{provider:"spotify",id:"1fPkUiufkRpzdYcBKXUP3s"},proof],metadata:{title,artists:["TOMONARI SORA"],artistsComplete:true,durationMs,verifiedAliases:[{references:[proof],metadata:{title:nativeTitle,artists:["友成空"],artistsComplete:true,durationMs}}]}};
}

test("provider-authorized native metadata fixes the actual Japanese rejection tuples",()=>{
 for(const [title,nativeTitle,durationMs,sourceMs,provider,id,isrc] of [["咆哮 - HOKO","HOKO",209766,209000,"spotify","1fPkUiufkRpzdYcBKXUP3s","JPB602501985"],["睨めっ娘","睨めっ娘",158850,159000,"spotify","3dPrNa7YVisbRaBBr3xdBj","JPB602401364"],["鬼ノ宴","鬼ノ宴",175998,176000,"spotify","096KHkONhQm4MQNH35mU22","JPB602400319"],["文明開化 (East West)","East West",148000,148000,"deezer","3609044902",null]] as const){
  const request=localizedFixture(title,nativeTitle,durationMs),ref={provider,id},proof=isrc?{provider:"isrc" as const,id:isrc}:ref;
  request.references=[ref,proof];request.metadata.verifiedAliases=[{...request.metadata.verifiedAliases![0],references:[proof]}];
  const candidate:AudioCandidate={candidateId:"native",audioKind:"full",metadata:{title:nativeTitle,artists:["友成空"],artistsComplete:false,durationMs:sourceMs},references:[{provider:"telegram",scope:"primary",id:"42"}]};
  assert.equal(assessAudioCandidate({...request,metadata:{...request.metadata,verifiedAliases:undefined}},candidate).acceptable,false);
  const actual=assessAudioCandidate(request,candidate);assert.equal(actual.acceptable,true);assert.equal(actual.authoritativeMatch,false,"catalog alias must not manufacture a source ISRC");
 }
});

test("verified spelling matching works across scripts without transliterating unknown metadata",()=>{
 const proof={provider:"isrc" as const,id:"KRA382000001"};
 const request:RecordingRequest={references:[proof],metadata:{title:"Spring Day",artists:["BTS"],artistsComplete:true,durationMs:274000,verifiedAliases:[{references:[proof],metadata:{title:"봄날",artists:["방탄소년단"],artistsComplete:true,durationMs:274000}}]}};
 const candidate:AudioCandidate={candidateId:"ko",audioKind:"full",metadata:{title:"봄날",artists:["방탄소년단"],artistsComplete:true,durationMs:274000}};
 assert.equal(assessAudioCandidate(request,candidate).acceptable,true);
 assert.equal(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,title:"Bomnal"}}).acceptable,false);
});

test("unbound, conflicting and source-only alias claims do not authorize metadata",()=>{
 const request=localizedFixture(),candidate:AudioCandidate={candidateId:"native",audioKind:"full",metadata:{title:"HOKO",artists:["友成空"],durationMs:209000}};
 const wrong={...request,metadata:{...request.metadata,verifiedAliases:request.metadata.verifiedAliases!.map(alias=>({...alias,references:[{provider:"isrc" as const,id:"JPB602501986"}]}))}};
 assert.equal(verifiedRecordingAliases(wrong).length,0);assert.equal(assessAudioCandidate(wrong,candidate).acceptable,false);
 assert.equal(assessAudioCandidate({...request,references:[]},candidate).acceptable,false);
 const claimed={...candidate,metadata:{...candidate.metadata,verifiedAliases:request.metadata.verifiedAliases}};
 assert.equal(assessAudioCandidate({...request,metadata:{...request.metadata,verifiedAliases:undefined}},claimed).acceptable,false);
 assert.equal(assessAudioCandidate(request,{...candidate,references:[{provider:"isrc",id:"JPB602501986"}]}).acceptable,false);
});

test("localized spelling aliases retain requested version, explicit and duration guards",()=>{
 const request=localizedFixture(),candidate:AudioCandidate={candidateId:"native",audioKind:"full",metadata:{title:"HOKO",artists:["友成空"],durationMs:209000}};
 for(const patch of [{title:"HOKO (Live)"},{title:"HOKO (Ayase Remix)"},{title:"HOKO (2012 Remaster)"},{durationMs:195000},{durationMs:null}])assert.equal(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,...patch}}).acceptable,false);
 assert.equal(assessAudioCandidate({...request,metadata:{...request.metadata,explicit:"explicit"}},{...candidate,metadata:{...candidate.metadata,explicit:"clean"}}).acceptable,false);
 assert.equal(assessAudioCandidate(request,{...candidate,audioKind:"preview"}).acceptable,false);
 assert.equal(assessAudioCandidate(request,{...candidate,audioKind:"unknown"}).acceptable,false);
 const variantAlias={...request,metadata:{...request.metadata,verifiedAliases:request.metadata.verifiedAliases!.map(alias=>({...alias,metadata:{...alias.metadata,title:"HOKO (Remix)"}}))}};
 assert.equal(verifiedRecordingAliases(variantAlias).length,0);
 const chained=localizedFixture("Song","歌",200000);chained.metadata.verifiedAliases=[{...chained.metadata.verifiedAliases![0],metadata:{...chained.metadata.verifiedAliases![0].metadata,durationMs:204500}}];
 assert.equal(assessAudioCandidate(chained,{...candidate,metadata:{title:"歌",artists:["友成空"],durationMs:209000}}).acceptable,false,"alias tolerances cannot accumulate beyond the original requested duration");
});

test("named localized remixes and guest credits stay exact",()=>{
 const request=localizedFixture("Song (Ayase Remix)","歌 (Ayase リミックス)",200000);
 request.metadata.artists=["TOMONARI SORA","Guest"];request.metadata.verifiedAliases=[{...request.metadata.verifiedAliases![0],metadata:{...request.metadata.verifiedAliases![0].metadata,artists:["友成空","ゲスト"]}}];
 const candidate:AudioCandidate={candidateId:"remix",audioKind:"full",metadata:{title:"歌 (Ayase リミックス)",artists:["友成空","ゲスト"],artistsComplete:true,durationMs:200000}};
 assert.equal(assessAudioCandidate(request,candidate).acceptable,true);
 assert.equal(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,title:"歌 (Other Remix)"}}).acceptable,false);
 assert.equal(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,artists:["友成空","Wrong Guest"]}}).acceptable,false);
 const omitted={...request,metadata:{...request.metadata,verifiedAliases:request.metadata.verifiedAliases!.map(alias=>({...alias,metadata:{...alias.metadata,artists:["友成空"]}}))}};
 assert.equal(verifiedRecordingAliases(omitted).length,0);
 const incomplete={...request,metadata:{...request.metadata,verifiedAliases:request.metadata.verifiedAliases!.map(alias=>({...alias,metadata:{...alias.metadata,artistsComplete:false}}))}};
 assert.equal(verifiedRecordingAliases(incomplete).length,0);
});

test("one exact catalogue row can authorize an official spelling while a Telegram row cannot",()=>{
 const request=localizedFixture(),ref={provider:"spotify" as const,id:"1fPkUiufkRpzdYcBKXUP3s"};
 request.references=[ref];request.metadata.verifiedAliases=[{...request.metadata.verifiedAliases![0],references:[ref]}];
 assert.equal(verifiedRecordingAliases(request).length,1);
 const sourceRef={provider:"telegram" as const,scope:"primary",id:"42"};request.references=[sourceRef];request.metadata.verifiedAliases=[{...request.metadata.verifiedAliases[0],references:[sourceRef]}];
 assert.equal(verifiedRecordingAliases(request).length,0);
 const invalid={provider:"spotify" as const,id:"not-a-catalog-id"};request.references=[invalid];request.metadata.verifiedAliases=[{...request.metadata.verifiedAliases[0],references:[invalid]}];
 assert.equal(verifiedRecordingAliases(request).length,0);
});

test("trusted aliases are projected without recursively retaining nested alias claims",()=>{
 const request=localizedFixture(),metadata=request.metadata.verifiedAliases![0].metadata as RecordingRequest["metadata"];
 metadata.verifiedAliases=request.metadata.verifiedAliases;
 const projected=verifiedRecordingAliases(request);
 assert.equal(projected.length,1);assert.equal("verifiedAliases" in projected[0].metadata,false);
 assert.doesNotThrow(()=>JSON.stringify(projected));
});

test("language-performance version labels cannot become original-song spelling aliases",()=>{
 const request=localizedFixture();
 for(const label of ["English ver.","Japanese ver.","日本語版","英語版","한국어 버전","일본어 버전","中文版","Versión en español"]){
  const metadata={...request.metadata.verifiedAliases![0].metadata,title:`HOKO (${label})`};
  const variant={...request,metadata:{...request.metadata,verifiedAliases:[{...request.metadata.verifiedAliases![0],metadata}]}};
  assert.ok(parseRecordingTitle(metadata.title).version.kinds.includes("edit"),label);
  assert.equal(verifiedRecordingAliases(variant).length,0,label);
  assert.equal(assessAudioCandidate(variant,{candidateId:"language",audioKind:"full",metadata}).acceptable,false,label);
 }
 assert.deepEqual(parseRecordingTitle("咆哮 - HOKO").version.kinds,[]);
 assert.deepEqual(parseRecordingTitle("咆哮 (HOKO)").version.kinds,[]);
 assert.ok(parseRecordingTitle("Song English ver.").version.kinds.includes("edit"));
 assert.ok(parseRecordingTitle("歌 日本語版").version.kinds.includes("edit"));
 assert.ok(parseRecordingTitle("Song (Off Vocal)").version.kinds.includes("instrumental"));
});

test("explicit English version accepts its ver. spelling while Japanese performance stays distinct",()=>{
 const request=localizedFixture("Song (English version)","歌 (English ver.)",200000);
 const candidate:AudioCandidate={candidateId:"english",audioKind:"full",metadata:{title:"歌 (English ver.)",artists:["友成空"],durationMs:200000}};
 assert.equal(assessAudioCandidate(request,candidate).acceptable,true);
 assert.equal(assessAudioCandidate(request,{...candidate,metadata:{...candidate.metadata,title:"歌 (Japanese ver.)"}}).acceptable,false);
});

test("generic performance kind followed by ver. does not invent another edit",()=>{
 for(const tag of ["Acoustic","Live","Instrumental","Remix","Demo","Radio Edit","Extended","Original","Off Vocal","Nightcore"]){
  const request:RecordingRequest={metadata:{title:`Song (${tag})`,artists:["Artist"],durationMs:180000}};
  const candidate:AudioCandidate={candidateId:tag,audioKind:"full",metadata:{title:`Song (${tag} ver.)`,artists:["Artist"],durationMs:180000}};
  assert.equal(assessAudioCandidate(request,candidate).acceptable,true,tag);
 }
 const nightcore:RecordingRequest={metadata:{title:"Song (Nightcore)",artists:["Artist"],durationMs:180000}};
 assert.equal(assessAudioCandidate(nightcore,{candidateId:"sped",audioKind:"full",metadata:{title:"Song (Sped Up)",artists:["Artist"],durationMs:180000}}).acceptable,false);
});
