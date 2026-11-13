"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MusicTrack } from "../app/types";
import type { TimedLyric } from "../lyrics/parse";
import { lyricReadingLanguage, readingEngine, type ReadingLanguage } from "../lyrics/language";
import { VERIFIED_LYRICS_VERSION } from "../lyrics/versions";
import { readJsonResponse, requestJson,responseIssue, userMessage, UserFacingError,type UserIssue } from "../app/errors";
import { LyricFlights } from "./lyricFlight";
import { LYRIC_REQUEST_TIMEOUT_MS, lyricRetryAfter, waitForLyrics } from "../lyrics/transport";
import { lyricRetryDelay,preserveLyricReadingLanguage, preserveLyricReadings } from "./lyricRecovery";
import type { AutoSyncEvidence } from "../lyrics/autoSync";
import {chooseReadingLanguage,rememberReadingGuides,type ReadingGuides} from "./readingCache";
import {browserOffline} from "../app/resourcePolicy";
import {LYRIC_WEEK_MS,lyricCacheFresh,lyricProviderCheckedAt} from "./lyricCachePolicy";
import {stableLyricCacheIdentity} from "./lyricCacheIdentity";
import { LyricMemory, type LyricGeneration } from "./lyricMemory";

export interface PlayerLyricLine extends TimedLyric { romanized?: string; readingReviewNeeded?: boolean; readingEngine?: string }
export interface PlayerLyrics {
  lines: PlayerLyricLine[];
  timing: "synced" | "plain";
  provider: string;
  providerTrackId: number;
  instrumental?: boolean;
  schemaVersion: string;
  hasJapanese: boolean;
  readingLanguage?: ReadingLanguage|null;
  autoSyncEvidence?: AutoSyncEvidence;
  /** Public-source eligibility proof; contains no account data or lyric text. */
  publicReadingProof?: string;
}
type CacheValue = { key: string; savedAt: number; checkedAt?:number; data: PlayerLyrics; guides?:ReadingGuides };
type MissingCacheValue={key:string;savedAt:number;checkedAt:number;missing:true;issue:UserIssue};
type StoredCacheValue=CacheValue&Partial<MissingCacheValue>;
type LyricInput = Pick<MusicTrack, "id" | "title" | "artists" | "albumTitle" | "durationMs"> & Partial<Pick<MusicTrack,"artistCredits">> & Partial<Pick<MusicTrack,"versionLabel" | "alternateTitles" | "language">>;
const cacheMemory = new LyricMemory<CacheValue | MissingCacheValue>();
const isMissing = (value: CacheValue | MissingCacheValue | undefined): value is MissingCacheValue => Boolean(value && "missing" in value && value.missing);
const memory = {
  get(key: string) { const value = cacheMemory.get(key); return value && !isMissing(value) ? value : undefined; },
  has(key: string) { return Boolean(this.get(key)); },
  set(_key: string, value: CacheValue) { cacheMemory.set(value); },
};
const missingMemory = {
  get(key: string) { const value = cacheMemory.get(key); return isMissing(value) ? value : undefined; },
  has(key: string) { return Boolean(this.get(key)); },
  set(_key: string, value: MissingCacheValue) { cacheMemory.set(value); },
  delete(key: string) { if (this.has(key)) cacheMemory.delete(key); },
};
export const lyricCacheMemoryStats = () => cacheMemory.stats();
let legacyKeys:Promise<Map<string,string[]>>|undefined;
const flights = new LyricFlights<PlayerLyrics>();
const readingFlights = new LyricFlights<PlayerLyrics | undefined>();
const subscribers = new Map<string, Set<(data: PlayerLyrics) => void>>();
class LyricLoadError extends UserFacingError {
  constructor(error: UserFacingError, readonly retryAfterMs?: number) {super(error.issue, error.status);}
}
let database: Promise<IDBDatabase> | undefined;
function validLines(value: unknown): value is PlayerLyricLine[] {
  return Array.isArray(value) && value.length <= 4000 && value.every((line, index) =>
    line && typeof line.text === "string" && Number.isFinite(line.start) && line.start >= 0 &&
    (line.end === undefined || Number.isFinite(line.end) && line.end >= line.start) &&
    (index === 0 || value[index - 1].start <= line.start));
}
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Lyrics storage unavailable")); return; }
    const request = indexedDB.open("sakura-v2-lyrics-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("lyrics", { keyPath: "key" });
    request.onsuccess = () => {const db=request.result;db.onversionchange=()=>{db.close();database=undefined;};resolve(db);};
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => { database = undefined; throw error; });
  return database;
}
async function readCache(key: string) {
  const owner = cacheMemory.acquire(key), version = owner.snapshot();
  try {
  const hit = memory.get(key);
  if (hit) return hit;
  if(missingMemory.has(key))return;
  try {
    const db = await openDatabase();
    let value=await storedCache(db,key);
    if(!value){
     const legacy=(await legacyCacheKeys(db)).get(key)||[];
     const candidates=(await Promise.all(legacy.map(oldKey=>storedCache(db,oldKey)))).filter((candidate):candidate is StoredCacheValue=>cacheRank(candidate,key)>=0);
     // A reading-engine upgrade may have left several identities behind.
     // Permanent synced lyrics must survive a later plain or missing fallback.
     value=candidates.sort((left,right)=>cacheRank(right,key)-cacheRank(left,key)||right.savedAt-left.savedAt)[0];
     if(value&&cacheRank(value,key)>0){
      let guides=rememberReadingGuides(value.guides,value.data);
      for(const candidate of candidates)if(cacheRank(candidate,key)>0){
       guides=rememberReadingGuides({...rememberReadingGuides(candidate.guides,candidate.data),...guides},value.data);
      }
      value={...value,guides};
     }
    }
    // An older database read must not replace a publication or reading choice
    // that was applied while its storage transaction was pending.
    if(!cacheMemory.writeCurrent(version))return memory.get(key);
    if(!value||stableLyricCacheIdentity(value.key)!==key)return;
    if(value.missing===true&&Number.isFinite(value.checkedAt)&&value.issue?.kind==="missing"&&typeof value.issue.message==="string"){
     const missing={...value,key} as MissingCacheValue;
     if(value.key!==key)await writeMissingCache(key,missing.issue,missing.checkedAt);else missingMemory.set(key,missing);
     return;
    }
    if(cacheRank(value,key)>0){
     const cached={...value,key} as CacheValue;
     if(value.key!==key)await writeCache(cached);else memory.set(key,cached);
     return memory.get(key) || cached;
    }
  } catch { return undefined; }
  } finally { owner.release(); }
}
function cacheRank(value:StoredCacheValue|undefined,key:string){
 if(!value||stableLyricCacheIdentity(value.key)!==key)return -1;
 if(value.missing===true)return Number.isFinite(value.checkedAt)&&value.issue?.kind==="missing"&&typeof value.issue.message==="string"?0:-1;
 if(!Number.isFinite(value.savedAt)||value.data?.schemaVersion!==VERIFIED_LYRICS_VERSION||!validLines(value.data.lines)||!value.data.instrumental&&!value.data.lines.some(line=>line.text.trim()))return -1;
 return value.data.timing==="synced"?2:value.data.timing==="plain"?1:-1;
}
function storedCache(db:IDBDatabase,key:string){return new Promise<StoredCacheValue|undefined>(resolve=>{
 const request=db.transaction("lyrics","readonly").objectStore("lyrics").get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(undefined);
});}
function legacyCacheKeys(db:IDBDatabase){return legacyKeys||(legacyKeys=new Promise<Map<string,string[]>>(resolve=>{
 const request=db.transaction("lyrics","readonly").objectStore("lyrics").getAllKeys();request.onsuccess=()=>{const keys=new Map<string,string[]>();for(const raw of request.result)if(typeof raw==="string"){const stable=stableLyricCacheIdentity(raw);if(stable!==raw)keys.set(stable,[...(keys.get(stable)||[]),raw]);}resolve(keys);};request.onerror=()=>{legacyKeys=undefined;resolve(new Map());};
}));}
async function writeCache(value: CacheValue) {
  const owner = cacheMemory.acquire(value.key);
  try {
  const previous=memory.get(value.key);
  value={...value,checkedAt:lyricProviderCheckedAt(value,previous)};
  value = {...value, data: preserveLyricReadings(previous?.data, value.data)};
  value.guides=rememberReadingGuides({...previous?.guides,...value.guides},value.data);
  memory.set(value.key, value);
  const version = owner.write();
  missingMemory.delete(value.key);
  subscribers.get(value.key)?.forEach(listener => listener(value.data));
  await persistCache(value,version);
  return value;
  } finally { owner.release(); }
}
async function writeMissingCache(key:string,issue:UserIssue,checkedAt=Date.now()){
 const owner = cacheMemory.acquire(key);
 try {
 const value:MissingCacheValue={key,savedAt:checkedAt,checkedAt,missing:true,issue};
 missingMemory.set(key,value);
 const version = owner.write();
 await persistCache(value,version);
 } finally { owner.release(); }
}
async function persistCache(value:CacheValue|MissingCacheValue,version:LyricGeneration){
  try {
    const db = await openDatabase();
    if(!cacheMemory.writeCurrent(version))return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("lyrics", "readwrite");
      tx.objectStore("lyrics").put(value);
      // Bound decoded memory, not saved songs: an offline library may contain
      // thousands of lyrics and reading guides that must survive later visits.
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* Lyrics still work when device storage is full or disabled. */ }
}
export function lyricInputKey(track: LyricInput) {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return JSON.stringify([VERIFIED_LYRICS_VERSION, normalize(track.title), [...new Set([...track.artists,...(track.artistCredits||[]).map(credit=>credit.name)].map(normalize))].sort(), normalize(track.albumTitle || ""), Math.round(track.durationMs / 1000), track.versionLabel,track.language,track.alternateTitles]);
}

/** An accepted upload must not reuse a lookup started before publication. */
export async function invalidateLyricsAfterPublication(track: LyricInput) {
  const key = lyricInputKey(track);
  const owner = cacheMemory.acquire(key), version = owner.publish();
  try {
  missingMemory.delete(key);
  flights.invalidate(key);
  if (!memory.has(key)) {
    try {
      const db = await openDatabase();
      if (!cacheMemory.writeCurrent(version) || memory.has(key)) return;
      await new Promise<void>(resolve => {
        const tx = db.transaction("lyrics", "readwrite");
        const store = tx.objectStore("lyrics"), read = store.get(key);
        read.onsuccess = () => { if (cacheMemory.writeCurrent(version) && read.result?.missing === true) store.delete(key); };
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
    } catch { /* The shared memory/flight boundary still refreshes without storage. */ }
  }
  } finally { owner.release(); }
}

/** Intent/next-song preparation shares the player's flight and persistent cache. */
export async function prefetchLyrics(track: LyricInput, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = { ...track, artists: [...new Set([...track.artists, ...(track.artistCredits || []).map(credit => credit.name)])] };
  const key = lyricInputKey(input);
  const owner = cacheMemory.acquire(key);
  try {
  const cached = await readCache(key), missing = missingMemory.get(key);
  signal.throwIfAborted();
  if (cached && lyricCacheFresh(cached.data.timing, lyricProviderCheckedAt(cached))) return cached.data;
  if (missing && lyricCacheFresh("missing", missing.checkedAt) || browserOffline()) return cached?.data;
  const request = flights.acquire(key, async sharedSignal => {
    const flightOwner = cacheMemory.acquire(key);
    try {
    const existing = memory.get(key), negative = missingMemory.get(key);
    if (existing && lyricCacheFresh(existing.data.timing, lyricProviderCheckedAt(existing))) return existing.data;
    if (negative && lyricCacheFresh("missing", negative.checkedAt)) throw new UserFacingError(negative.issue, 404);
    const publicationBefore = flightOwner.snapshot();
    const query = new URLSearchParams({ recordingId: input.id, title: input.title });
    for (const artist of input.artists.length ? input.artists : [""]) query.append("artist", artist);
    if (input.durationMs > 0) query.set("duration", String(input.durationMs / 1000));
    if (input.albumTitle) query.set("album", input.albumTitle);
    if (input.versionLabel) query.set("version", input.versionLabel);
    if (input.language) query.set("language", input.language);
    for (const title of input.alternateTitles || []) query.append("alternateTitle", title);
    if (cached || missing) query.set("refresh", "1");
    const response = await fetch(`/api/v2/lyrics?${query}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([sharedSignal, AbortSignal.timeout(LYRIC_REQUEST_TIMEOUT_MS)]) });
    const confirmedMissing = response.status === 404 && await response.clone().json().then(raw => raw?.status === "missing").catch(() => false);
    if (confirmedMissing) {
      sharedSignal.throwIfAborted();
      const previous = memory.get(key) || cached;
      if (previous) { await writeCache({ ...previous, savedAt: Date.now(), checkedAt: Date.now() }); return previous.data; }
      if (cacheMemory.publicationCurrent(publicationBefore)) await writeMissingCache(key, responseIssue(404, null, "lyrics"));
    }
    const payload = await readJsonResponse<PlayerLyrics>(response, { context: "lyrics" });
    if (!validLines(payload.lines) || payload.schemaVersion !== VERIFIED_LYRICS_VERSION || !["synced", "plain"].includes(payload.timing) || !payload.instrumental && !payload.lines.some(line => line.text.trim())) throw new Error("Lyrics provider returned an invalid response.");
    sharedSignal.throwIfAborted();
    if (!cacheMemory.publicationCurrent(publicationBefore) && memory.get(key)) return memory.get(key)!.data;
    const { publicReadingProof, ...sourcePayload } = payload;
    const data: PlayerLyrics = { ...sourcePayload,
      ...(typeof publicReadingProof === "string" && publicReadingProof.length <= 1024 ? { publicReadingProof } : {}),
      hasJapanese: payload.lines.some(line => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)), readingLanguage: lyricReadingLanguage(payload.lines.map(line => line.text).join("\n"), input.language) };
    return (await writeCache({ key, savedAt: Date.now(), checkedAt: Date.now(), data: preserveLyricReadingLanguage(memory.get(key)?.data, data) })).data;
    } finally { flightOwner.release(); }
  });
  return await waitForLyricFlight(request, signal);
  } finally { owner.release(); }
}

function waitForLyricFlight<T>(request: { promise: Promise<T>; release: () => void }, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (work: () => void) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); request.release(); work(); };
    const abort = () => finish(() => reject(signal.reason ?? new DOMException("Canceled", "AbortError")));
    signal.addEventListener("abort", abort, { once: true });
    request.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal.aborted) abort();
  });
}

async function prepareReadings(input: LyricInput, requestedLanguage: ReadingLanguage | undefined, signal: AbortSignal, accountId?: string | null) {
  signal.throwIfAborted();
  const key = lyricInputKey(input), owner = cacheMemory.acquire(key);
  try {
    const cached = await readCache(key), source = cached?.data;
    signal.throwIfAborted();
    const language = requestedLanguage || source?.readingLanguage || "ja", engine = readingEngine(language);
    if (!source || source.lines.every(line => !line.text.trim() || line.readingEngine === engine && typeof line.romanized === "string")) return source;
    const prepared = chooseReadingLanguage(source, language, rememberReadingGuides(cached?.guides, source));
    if (prepared.lines.every(line => !line.text.trim() || typeof line.romanized === "string" && line.readingEngine === engine)) {
      return (await writeCache({ key, savedAt: Date.now(), data: prepared })).data;
    }
    if (browserOffline()) throw new Error("This reading guide has not been saved yet. Reconnect once to prepare it for offline listening.");
    const content = JSON.stringify(source.lines.map(line => line.text));
    const request = readingFlights.acquire(key + language + content, async sharedSignal => {
      const flightOwner = cacheMemory.acquire(key), publicationBefore = flightOwner.snapshot();
      try {
        const publicReadingProof = typeof source.publicReadingProof === "string" && source.publicReadingProof.length <= 1024 ? source.publicReadingProof : undefined;
        const lines = source.lines.map(({ text, start, end, words }) => ({ text, start, ...(end === undefined ? {} : { end }), ...(words === undefined ? {} : { words }) }));
        const payload = await requestJson<{ engine: string; lines: PlayerLyricLine[] }>("/api/v2/readings", { method: "POST", signal: sharedSignal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: input.id, language, lines, publicReadingProof }) }, { context: "lyrics", accountId: accountId || undefined });
        sharedSignal.throwIfAborted();
        if (payload.engine !== engine || !validLines(payload.lines) || payload.lines.length !== source.lines.length || payload.lines.some((line, index) => line.text !== source.lines[index].text || line.start !== source.lines[index].start || line.end !== source.lines[index].end || JSON.stringify(line.words) !== JSON.stringify(source.lines[index].words) || typeof line.romanized !== "string" || line.readingEngine !== engine)) throw new Error("The reading guide did not match these lyrics.");
        const latest = memory.get(key)?.data;
        if (!cacheMemory.publicationCurrent(publicationBefore) || latest && JSON.stringify(latest.lines.map(line => line.text)) !== content) return latest;
        const guideData = { ...source, readingLanguage: language, lines: payload.lines };
        const guides = rememberReadingGuides(memory.get(key)?.guides, guideData);
        const data = latest?.readingLanguage && latest.readingLanguage !== language ? latest : chooseReadingLanguage(latest || source, language, guides);
        return (await writeCache({ key, savedAt: Date.now(), data, guides })).data;
      } finally { flightOwner.release(); }
    });
    return await waitForLyricFlight(request, signal);
  } finally { owner.release(); }
}

/** Only the saved, enabled preference is prepared; the caller owns audio/intent
 * admission and cancellation. It shares the visible player's exact cache. */
export async function prefetchPreferredReadings(track: LyricInput, preferences: { japaneseReading?: boolean; lyricReading?: boolean }, signal: AbortSignal, accountId?: string | null) {
  const source = await prefetchLyrics(track, signal);
  signal.throwIfAborted();
  const language = source?.readingLanguage || (source?.hasJapanese ? "ja" : null);
  if (!source || !language || !(language === "ja" ? preferences.japaneseReading : preferences.lyricReading)) return source;
  return prepareReadings(track, language, signal, accountId);
}

export async function prefetchReadings(track: LyricInput, language: ReadingLanguage, signal: AbortSignal, accountId?: string | null) {
  return prepareReadings(track, language, signal, accountId);
}
export function useLyrics(track: MusicTrack | null) {
  const [retryVersion,setRetryVersion]=useState(0);
  const [refreshKey,setRefreshKey]=useState("");
  const [result, setResult] = useState<{ key: string; data: PlayerLyrics | null; error: string | null; loading: boolean }>({ key: "", data: null, error: null, loading: false });
  const key = track ? lyricInputKey(track) : "";
  // The player can replace a catalog object while resolving it. Equal lyric
  // metadata must keep the same subscription instead of canceling and fetching.
  const input = useMemo<LyricInput | null>(() => {
    if (!key) return null;
    return { id: track!.id, title: track!.title, artists: [...new Set([...track!.artists,...(track!.artistCredits||[]).map(credit=>credit.name)])], albumTitle: track!.albumTitle, durationMs: track!.durationMs,versionLabel:track!.versionLabel,alternateTitles:track!.alternateTitles,language:track!.language };
  // The normalized key intentionally keeps this object stable when catalog
  // resolution only replaces a temporary recording ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!key) return;
    const owner = cacheMemory.acquire(key);
    const listener = (data: PlayerLyrics) => setResult(previous => previous.key === key ? {...previous, data, error: null, loading: false} : {key, data, error: null, loading: false});
    const listeners = subscribers.get(key) || new Set<(data: PlayerLyrics) => void>();
    listeners.add(listener); subscribers.set(key, listeners);
    return () => {listeners.delete(listener); if (!listeners.size) subscribers.delete(key); owner.release();};
  }, [key]);
  useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let waitingForRetry = false;
    let retryNotBefore = 0;
    let weeklyTimer:ReturnType<typeof setTimeout>|undefined;
    const retryConnection = () => {if (waitingForRetry && Date.now() >= retryNotBefore && !controller.signal.aborted && document.visibilityState !== "hidden") setRetryVersion(version => version + 1);};
    const checkNextWeek=(checkedAt:number)=>{waitingForRetry=true;retryNotBefore=checkedAt+LYRIC_WEEK_MS;clearTimeout(weeklyTimer);weeklyTimer=setTimeout(retryConnection,Math.max(1000,retryNotBefore-Date.now()));};
    window.addEventListener("online", retryConnection);
    document.addEventListener("visibilitychange", retryConnection);
    const thisKey = lyricInputKey(input);
    void (async () => {
      let cached = await readCache(thisKey);
      const missing=missingMemory.get(thisKey),explicitRefresh=retryVersion>0&&refreshKey===thisKey;
      if (controller.signal.aborted) return;
      if (cached) setResult({ key: thisKey, data: cached.data, error: null, loading: false });
      if (cached && !explicitRefresh&&lyricCacheFresh(cached.data.timing,lyricProviderCheckedAt(cached))) {if(cached.data.timing==="plain")checkNextWeek(lyricProviderCheckedAt(cached));return;}
      if(missing&&!explicitRefresh&&lyricCacheFresh("missing",missing.checkedAt)){setResult({key:thisKey,data:null,error:missing.issue.message,loading:false});checkNextWeek(missing.checkedAt);return;}
      if(browserOffline()){
        if(!cached)setResult({key:thisKey,data:null,error:missing?.issue.message||"Lyrics have not been saved for this song yet. Open its lyrics while connected to keep them available offline.",loading:false});
        waitingForRetry=true;return;
      }
      if (!cached) setResult({ key: thisKey, data: null, error: null, loading: true });
      let attempts = 0;
      while (!controller.signal.aborted) { try {
        waitingForRetry = false;
        const request = flights.acquire(thisKey, async signal => {
          const flightOwner = cacheMemory.acquire(thisKey);
          try {
          // A second view can finish its IndexedDB lookup just after the first
          // request completed. Recheck the shared value before starting work.
          const shared=memory.get(thisKey),sharedMissing=missingMemory.get(thisKey);
          if(!explicitRefresh&&shared&&lyricCacheFresh(shared.data.timing,lyricProviderCheckedAt(shared)))return shared.data;
          if(!explicitRefresh&&sharedMissing&&lyricCacheFresh("missing",sharedMissing.checkedAt))throw new UserFacingError(sharedMissing.issue,404);
          const publicationBefore = flightOwner.snapshot();
          const query = new URLSearchParams({ recordingId: input.id, title: input.title });
          for (const artist of input.artists.length ? input.artists : [""]) query.append("artist", artist);
          if (input.durationMs > 0) query.set("duration", String(input.durationMs / 1000));
          if (input.albumTitle) query.set("album", input.albumTitle);
          if(input.versionLabel)query.set("version",input.versionLabel);
          if(input.language)query.set("language",input.language);
          for(const title of input.alternateTitles||[])query.append("alternateTitle",title);
          if(explicitRefresh||cached||missing)query.set("refresh","1");
          const response = await fetch(`/api/v2/lyrics?${query}`, {credentials: "same-origin",cache:"no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(LYRIC_REQUEST_TIMEOUT_MS)])});
          const confirmedMissing=response.status===404&&await response.clone().json().then(raw=>raw?.status==="missing").catch(()=>false);
          let payload: PlayerLyrics;
          try {payload = await readJsonResponse<PlayerLyrics>(response, {context: "lyrics"});}
          catch (error) {
            if(response.status===404&&!confirmedMissing)throw new LyricLoadError(new UserFacingError(responseIssue(503,null,"lyrics"),503),lyricRetryAfter(response.headers.get("Retry-After")));
            if(error instanceof UserFacingError&&error.status===404&&confirmedMissing){signal.throwIfAborted();const previous=memory.get(thisKey)||cached;
              if(previous)await writeCache({...previous,savedAt:Date.now(),checkedAt:Date.now()});
              else if(cacheMemory.publicationCurrent(publicationBefore))await writeMissingCache(thisKey,error.issue);
            }
            throw error instanceof UserFacingError ? new LyricLoadError(error, lyricRetryAfter(response.headers.get("Retry-After"))) : error;
          }
          if (!validLines(payload.lines) || !["synced", "plain"].includes(payload.timing) || (!payload.instrumental && !payload.lines.some(line => line.text.trim()))) throw new Error("Lyrics provider returned an invalid response.");
          const data: PlayerLyrics = { lines: payload.lines, timing: payload.timing, provider: payload.provider, providerTrackId: payload.providerTrackId, instrumental: payload.instrumental, schemaVersion: payload.schemaVersion,
            ...(typeof payload.publicReadingProof === "string" && payload.publicReadingProof.length <= 1024 ? { publicReadingProof: payload.publicReadingProof } : {}),
            ...(payload.autoSyncEvidence?{autoSyncEvidence:payload.autoSyncEvidence}:{}),
            readingLanguage: lyricReadingLanguage(payload.lines.map(line=>line.text).join("\n"),input.language),
            hasJapanese: payload.lines.some((line: PlayerLyricLine) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) };
          signal.throwIfAborted();
          // A pre-publication provider request can finish after the upload. It
          // must never overwrite the freshly read LRCLIB result on this device.
          if(!cacheMemory.publicationCurrent(publicationBefore)&&memory.get(thisKey))return memory.get(thisKey)!.data;
          return (await writeCache({ key: thisKey, savedAt: Date.now(),checkedAt:Date.now(), data:preserveLyricReadingLanguage(memory.get(thisKey)?.data,data) })).data;
          } finally { flightOwner.release(); }
        });
        release = request.release;
        const data = await waitForLyricFlight(request, controller.signal);
        if (controller.signal.aborted) return;
        setResult({ key: thisKey, data, error: null, loading: false });
        if(data.timing==="plain")checkNextWeek(lyricProviderCheckedAt(memory.get(thisKey)||{savedAt:Date.now()}));
        setRefreshKey(previous=>previous===thisKey?"":previous);
        return;
      } catch (error) {
        if (controller.signal.aborted) return;
        cached = memory.get(thisKey) || cached;
        setResult({ key: thisKey, data: cached?.data || null, error: cached ? null : userMessage(error,"lyrics"), loading: false });
        if(error instanceof UserFacingError&&error.status===404){checkNextWeek(missingMemory.get(thisKey)?.checkedAt||lyricProviderCheckedAt(cached||{savedAt:Date.now()}));setRefreshKey(previous=>previous===thisKey?"":previous);return;}
        const delay = lyricRetryDelay(attempts++, error instanceof UserFacingError ? error.status : undefined, error instanceof LyricLoadError ? error.retryAfterMs : undefined);
        if (delay === undefined) return;
        waitingForRetry = true;
        retryNotBefore = error instanceof LyricLoadError && error.retryAfterMs ? Date.now() + delay : 0;
        release?.(); release = undefined;
        await waitForLyrics(delay, controller.signal).catch(() => undefined);
      } finally {release?.(); release = undefined;} }
    })();
    return () => { controller.abort();release?.();clearTimeout(weeklyTimer);window.removeEventListener("online", retryConnection);document.removeEventListener("visibilitychange", retryConnection); };
  }, [key, input, retryVersion,refreshKey]);
  const applyPublishedLyrics=useCallback(async(payload?:PlayerLyrics)=>{
    if(!input||!key)return;
    if(!payload){await invalidateLyricsAfterPublication(input);setRefreshKey(key);setRetryVersion(version=>version+1);return;}
    if(!validLines(payload.lines)||payload.schemaVersion!==VERIFIED_LYRICS_VERSION||!payload.lines.some(line=>line.text.trim()))throw new Error("Published lyrics did not match a valid provider response.");
    const data={...payload,hasJapanese:payload.lines.some(line=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)),readingLanguage:lyricReadingLanguage(payload.lines.map(line=>line.text).join("\n"),input.language)};
    const owner = cacheMemory.acquire(key);
    try { owner.publish(); await writeCache({key,savedAt:Date.now(),checkedAt:Date.now(),data:preserveLyricReadingLanguage(memory.get(key)?.data,data)}); }
    finally { owner.release(); }
  },[input,key]);
  const setReadingLanguage=useCallback(async(language:ReadingLanguage)=>{
    if(!key)return;
    const cached=await readCache(key);
    if(!cached)return;
    await writeCache({key,savedAt:Date.now(),data:chooseReadingLanguage(cached.data,language,rememberReadingGuides(cached.guides,cached.data))});
  },[key]);
  const applyAutoSync=useCallback(async(lines:TimedLyric[],evidence:AutoSyncEvidence)=>{
    if(!key)return;
    const owner = cacheMemory.acquire(key);
    try {
    const source=(await readCache(key))?.data;
    if(!source||source.timing!=="plain"||!validLines(lines)||lines.length!==source.lines.length||lines.some((line,index)=>line.text!==source.lines[index].text))throw new Error("The sync result no longer matches these plain lyrics.");
    const publicationBefore = owner.snapshot();
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(source.lines.map(line=>line.text))));
    const sourceContentKey=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(evidence.sourceContentKey!==sourceContentKey||evidence.engine!=="whisper-small-en-v1"||!Number.isFinite(evidence.confidence)||evidence.confidence<0||evidence.confidence>1||!/^[a-f0-9]{64}$/.test(evidence.audioSha256))throw new Error("The sync evidence does not match this recording's lyrics.");
    const latest=memory.get(key)?.data||source;
    if(!cacheMemory.publicationCurrent(publicationBefore)||latest.timing!=="plain"||latest.lines.length!==source.lines.length||latest.lines.some((line,index)=>line.text!==source.lines[index].text))throw new Error("The lyrics changed while syncing. Your latest words have been kept.");
    // Preserve readings by source line while replacing only verified timing.
    const updated=lines.map((line,index)=>({...latest.lines[index],...line}));
    owner.publish();
    await writeCache({key,savedAt:Date.now(),data:{...latest,lines:updated,timing:"synced",autoSyncEvidence:evidence}});
    } finally { owner.release(); }
  },[key]);
  const getJapaneseReadings = useCallback(async (requestedLanguage?: ReadingLanguage, signal?: AbortSignal, accountId?: string | null) => {
    if (!input || !key) return;
    await prepareReadings(input, requestedLanguage, signal || new AbortController().signal, accountId);
  }, [input, key]);
  return { data: result.key === key ? result.data : null, loading: Boolean(track) && (result.key !== key || result.loading), error: result.key === key ? result.error : null, getJapaneseReadings,setReadingLanguage,applyPublishedLyrics,applyAutoSync,retry:()=>{setRefreshKey(key);setRetryVersion(v=>v+1);} };
}
