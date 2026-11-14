import assert from "node:assert/strict";
import { test } from "node:test";
import type { MusicTrack } from "../src/rebuild/app/types";
import { prefetchLyrics, invalidateLyricsAfterPublication,lyricInputKey } from "../src/rebuild/player/useLyrics";

const track = (title: string) => ({ id: title, title, artists: ["Artist"], artistCredits: [{ name: "Guest" }], durationMs: 180_000, albumTitle: "Album", versionLabel: "Original recording", language: "ja" }) as MusicTrack;
const payload = (text = "Fixture words") => ({ schemaVersion: "verified-lyrics-v3", provider: "fixture", providerTrackId: 1, timing: "synced", lines: [{ text, start: 1 }] });

test("lyric intent preparation shares one request, preserves all credits/language and reuses the cache", async () => {
  const previous = globalThis.fetch;
  let calls = 0, query: URLSearchParams | undefined;
  globalThis.fetch = async address => { calls++; query = new URL(String(address), "https://sakura.test").searchParams; return Response.json(payload()); };
  try {
    const song = track("prefetch-shared");
    const [first, second] = await Promise.all([prefetchLyrics(song, new AbortController().signal), prefetchLyrics(song, new AbortController().signal)]);
    assert.equal(calls, 1); assert.deepEqual(first?.lines, second?.lines);
    assert.deepEqual(query?.getAll("artist"), ["Artist", "Guest"]); assert.equal(query?.get("language"), "ja");
    await prefetchLyrics({ ...song, id: "canonical-id" }, new AbortController().signal);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test("canceling one lyric prefetch leaves its second consumer active", async () => {
  const previous = globalThis.fetch;
  let finish!: (response: Response) => void, sharedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_address, options) => { sharedSignal = options?.signal; return new Promise(resolve => { finish = resolve; }); };
  try {
    const song = track("prefetch-cancellation"), one = new AbortController(), two = new AbortController();
    const first = prefetchLyrics(song, one.signal), rejected = assert.rejects(first, { name: "AbortError" });
    const second = prefetchLyrics(song, two.signal);
    await new Promise(resolve => setImmediate(resolve));
    one.abort(); await rejected; assert.equal(sharedSignal?.aborted, false);
    finish(Response.json(payload())); assert.equal((await second)?.lines[0].text, "Fixture words");
  } finally { globalThis.fetch = previous; }
});

test("publication acceptance clears a confirmed negative and aborts pre-publication flights", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({ status: "missing" }, { status: 404 }) : Response.json(payload("Published fixture")); };
  try {
    const song = track("prefetch-publication");
    await assert.rejects(prefetchLyrics(song, new AbortController().signal));
    await prefetchLyrics(song, new AbortController().signal); assert.equal(calls, 1);
    await invalidateLyricsAfterPublication(song);
    assert.equal((await prefetchLyrics(song, new AbortController().signal))?.lines[0].text, "Published fixture");
    assert.equal(calls, 2);

    const race = track("prefetch-publication-race");
    let oldResponse!: (response: Response) => void;
    globalThis.fetch = async () => new Promise(resolve => { oldResponse = resolve; });
    const old = prefetchLyrics(race, new AbortController().signal), oldRejected = assert.rejects(old, { name: "AbortError" });
    await new Promise(resolve => setImmediate(resolve));
    await invalidateLyricsAfterPublication(race);
    globalThis.fetch = async () => Response.json(payload("New publication"));
    assert.equal((await prefetchLyrics(race, new AbortController().signal))?.lines[0].text, "New publication");
    oldResponse(Response.json({ status: "missing" }, { status: 404 })); await oldRejected;
    assert.equal((await prefetchLyrics(race, new AbortController().signal))?.lines[0].text, "New publication");
  } finally { globalThis.fetch = previous; }
});

test("provider failures are retried instead of cached as missing lyrics", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({ status: "unavailable" }, { status: 503 }) : Response.json(payload()); };
  try {
    const song = track("prefetch-provider-outage");
    await assert.rejects(prefetchLyrics(song, new AbortController().signal));
    assert.equal((await prefetchLyrics(song, new AbortController().signal))?.timing, "synced"); assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});

test("network lyric preparation finishes before a pending durable cache write", async () => {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  const writes:{oncomplete?:()=>void;onerror?:()=>void;onabort?:()=>void;abort:()=>void}[]=[];
  const db={close(){},transaction(_store:string,mode:string){
    const tx={objectStore(){return {
      get(){const request:{result?:unknown;onsuccess?:()=>void}={};queueMicrotask(()=>request.onsuccess?.());return request;},
      getAllKeys(){const request:{result:unknown[];onsuccess?:()=>void}={result:[]};queueMicrotask(()=>request.onsuccess?.());return request;},
      put(){}
    };},abort(){tx.onabort?.();},oncomplete:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void)};
    if(mode==="readwrite")writes.push(tx);return tx;
  }};
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request:{result:typeof db;onsuccess?:()=>void}={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}}});
  globalThis.fetch=async()=>Response.json(payload("Ready before storage"));
  try {
    let ready:Awaited<ReturnType<typeof prefetchLyrics>>;
    const work=prefetchLyrics(track("prefetch-background-storage"),new AbortController().signal).then(value=>{ready=value;return value;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writes.length,1);
    assert.equal(ready!.lines[0].text,"Ready before storage","a stalled IndexedDB write cannot hold the completed provider result");
    writes[0].oncomplete?.();await work;
  } finally {
    writes.forEach(tx=>tx.onabort?.());
    (db as typeof db&{onversionchange?:()=>void}).onversionchange?.();
    globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});

test("canceling a prefetch during storage hydration returns immediately without a provider request", async () => {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  let calls=0;
  const requests:{onblocked?:()=>void}[]=[];
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request:{onblocked?:()=>void}={};requests.push(request);return request;}}});
  globalThis.fetch=async()=>{calls++;return Response.json(payload());};
  try {
    const controller=new AbortController(),work=prefetchLyrics(track("prefetch-storage-cancel"),controller.signal),rejected=assert.rejects(work,{name:"AbortError"});
    await new Promise(resolve=>setImmediate(resolve));controller.abort();await rejected;
    assert.equal(calls,0);requests.forEach(request=>request.onblocked?.());
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
  } finally {
    requests.forEach(request=>request.onblocked?.());globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});

test("a blocked lyrics database falls through to the provider and closes late connections", async () => {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  let calls=0,closed=0;
  const db={close(){closed++;}},requests:{result:typeof db;onblocked?:()=>void;onsuccess?:()=>void}[]=[];
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request={result:db,onblocked:undefined as undefined|(()=>void),onsuccess:undefined as undefined|(()=>void)};requests.push(request);queueMicrotask(()=>request.onblocked?.());return request;}}});
  globalThis.fetch=async()=>{calls++;return Response.json(payload("Works without storage"));};
  try {
    assert.equal((await prefetchLyrics(track("prefetch-blocked-storage"),new AbortController().signal))?.lines[0].text,"Works without storage");
    assert.equal(calls,1);requests[0].onsuccess?.();assert.equal(closed,1);
  } finally {
    requests.forEach(request=>request.onblocked?.());globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});

test("lost storage open callbacks have a deadline while a completed lyric request remains usable", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  let calls=0,closed=0;
  const db={close(){closed++;}},requests:{result:typeof db;onsuccess?:()=>void;onblocked?:()=>void}[]=[];
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request:{result:typeof db;onsuccess?:()=>void;onblocked?:()=>void}={result:db};requests.push(request);return request;}}});
  globalThis.fetch=async()=>{calls++;return Response.json(payload("Storage deadline fallback"));};
  try {
    const work=prefetchLyrics(track("prefetch-lost-open"),new AbortController().signal);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
    t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await work)?.lines[0].text,"Storage deadline fallback");assert.equal(calls,1);
    requests[0].onsuccess?.();assert.equal(closed,1);
    t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
  } finally {
    requests.forEach(request=>request.onblocked?.());globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});

test("slow hydration cannot replace permanent synced disk lyrics with a plain or missing fallback", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  const songs=[track("slow-disk-plain"),track("slow-disk-missing")];
  const stored=new Map(songs.map(song=>[lyricInputKey(song),{key:lyricInputKey(song),savedAt:Date.now(),data:payload("Permanent synced words")}])) ,slowReads:{result?:unknown;onsuccess?:()=>void}[]=[];
  let puts=0,calls=0;
  const db={close(){},transaction(_store:string,mode:string){
    const tx={objectStore(){return {
      get(key:string){const request:{result?:unknown;onsuccess?:()=>void}={result:stored.get(key)};
        if(mode==="readonly")slowReads.push(request);else queueMicrotask(()=>{request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return request;},
      getAllKeys(){const request:{result:unknown[];onsuccess?:()=>void}={result:[]};queueMicrotask(()=>request.onsuccess?.());return request;},
      put(value:{key:string;savedAt:number;data:ReturnType<typeof payload>}){puts++;stored.set(value.key,value);}
    };},abort(){tx.onabort?.();},oncomplete:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void)};return tx;
  }};
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request:{result:typeof db;onsuccess?:()=>void}={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}}});
  globalThis.fetch=async address=>{calls++;return String(address).includes("slow-disk-missing")?Response.json({status:"missing"},{status:404}):Response.json({...payload("Fallback plain words"),timing:"plain"});};
  try {
    for(const song of songs){
      const work=prefetchLyrics(song,new AbortController().signal),result=work.catch(()=>undefined);
      await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);
      await result;await new Promise(resolve=>setImmediate(resolve));
      assert.equal(stored.get(lyricInputKey(song))?.data.timing,"synced");
      assert.equal((await prefetchLyrics(song,new AbortController().signal))?.lines[0].text,"Permanent synced words");
    }
    assert.equal(puts,0);assert.equal(calls,2);
    slowReads.forEach(request=>request.onsuccess?.());await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await prefetchLyrics(songs[0],new AbortController().signal))?.timing,"synced");
  } finally {
    (db as typeof db&{onversionchange?:()=>void}).onversionchange?.();globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});

test("publication invalidates a cache write while its atomic disk comparison is pending", async () => {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,"indexedDB"),previousFetch=globalThis.fetch;
  let puts=0,pending:{result?:unknown;onsuccess?:()=>void}|undefined;
  const db={close(){},transaction(_store:string,mode:string){
    const tx={objectStore(){return {
      get(){const request:{result?:unknown;onsuccess?:()=>void}={};if(mode==="readwrite")pending=request;else queueMicrotask(()=>request.onsuccess?.());return request;},
      getAllKeys(){const request:{result:unknown[];onsuccess?:()=>void}={result:[]};queueMicrotask(()=>request.onsuccess?.());return request;},
      put(){puts++;}
    };},abort(){tx.onabort?.();},oncomplete:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void)};return tx;
  }};
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open(){const request:{result:typeof db;onsuccess?:()=>void}={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}}});
  globalThis.fetch=async()=>Response.json(payload("Before publication"));
  try {
    const song=track("atomic-write-publication");await prefetchLyrics(song,new AbortController().signal);
    await new Promise(resolve=>setImmediate(resolve));assert.ok(pending);
    await invalidateLyricsAfterPublication(song);pending.onsuccess?.();assert.equal(puts,0);
  } finally {
    (db as typeof db&{onversionchange?:()=>void}).onversionchange?.();globalThis.fetch=previousFetch;
    if(previousStorage)Object.defineProperty(globalThis,"indexedDB",previousStorage);else Reflect.deleteProperty(globalThis,"indexedDB");
  }
});
