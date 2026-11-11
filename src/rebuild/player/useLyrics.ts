"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MusicTrack } from "../app/types";
import type { TimedLyric } from "../lyrics/parse";
import { lyricReadingLanguage, readingEngine, READING_VERSION, type ReadingLanguage } from "../lyrics/language";
import { VERIFIED_LYRICS_VERSION } from "../lyrics/versions";
import { readJsonResponse, requestJson, userMessage, UserFacingError,type UserIssue } from "../app/errors";
import { LyricFlights } from "./lyricFlight";
import { LYRIC_REQUEST_TIMEOUT_MS, lyricRetryAfter, waitForLyrics } from "../lyrics/transport";
import { lyricRetryDelay, preserveLyricReadings } from "./lyricRecovery";
import type { AutoSyncEvidence } from "../lyrics/autoSync";
import {chooseReadingLanguage,rememberReadingGuides,type ReadingGuides} from "./readingCache";
import {browserOffline} from "../app/resourcePolicy";
import {LYRIC_WEEK_MS,lyricCacheFresh,lyricProviderCheckedAt} from "./lyricCachePolicy";

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
}
type CacheValue = { key: string; savedAt: number; checkedAt?:number; data: PlayerLyrics; guides?:ReadingGuides };
type MissingCacheValue={key:string;savedAt:number;checkedAt:number;missing:true;issue:UserIssue};
type LyricInput = Pick<MusicTrack, "id" | "title" | "artists" | "albumTitle" | "durationMs"> & Partial<Pick<MusicTrack,"artistCredits">> & Partial<Pick<MusicTrack,"versionLabel" | "alternateTitles" | "language">>;
const memory = new Map<string, CacheValue>();
const missingMemory=new Map<string,MissingCacheValue>();
const flights = new LyricFlights<PlayerLyrics>();
const readingFlights = new LyricFlights<PlayerLyrics>();
const subscribers = new Map<string, Set<(data: PlayerLyrics) => void>>();
const publicationVersions=new Map<string,number>();
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
  const hit = memory.get(key);
  if (hit) return hit;
  if(missingMemory.has(key))return;
  try {
    const db = await openDatabase();
    return await new Promise<CacheValue | undefined>((resolve) => {
      const request = db.transaction("lyrics", "readonly").objectStore("lyrics").get(key);
      request.onsuccess = () => {
        const value = request.result as CacheValue&Partial<MissingCacheValue> | undefined;
        if(value?.key===key&&value.missing===true&&Number.isFinite(value.checkedAt)&&value.issue?.kind==="missing"&&typeof value.issue.message==="string"){missingMemory.set(key,value as MissingCacheValue);resolve(undefined);}
        else if (value?.key === key && Number.isFinite(value.savedAt) && value.data?.schemaVersion === VERIFIED_LYRICS_VERSION && validLines(value.data.lines) && (value.data.instrumental || value.data.lines.some(line => line.text.trim()))) { memory.set(key, value); resolve(value); }
        else resolve(undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
async function writeCache(value: CacheValue) {
  const previous=memory.get(value.key);
  value={...value,checkedAt:lyricProviderCheckedAt(value,previous)};
  value = {...value, data: preserveLyricReadings(previous?.data, value.data)};
  value.guides=rememberReadingGuides({...previous?.guides,...value.guides},value.data);
  memory.set(value.key, value);
  missingMemory.delete(value.key);
  subscribers.get(value.key)?.forEach(listener => listener(value.data));
  while (memory.size > 128) memory.delete(memory.keys().next().value!);
  await persistCache(value);
}
async function writeMissingCache(key:string,issue:UserIssue){
 const checkedAt=Date.now(),value:MissingCacheValue={key,savedAt:checkedAt,checkedAt,missing:true,issue};
 missingMemory.set(key,value);
 while(missingMemory.size>128)missingMemory.delete(missingMemory.keys().next().value!);
 await persistCache(value);
}
async function persistCache(value:CacheValue|MissingCacheValue){
  try {
    const db = await openDatabase();
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
  return JSON.stringify([VERIFIED_LYRICS_VERSION, READING_VERSION, normalize(track.title), [...new Set([...track.artists,...(track.artistCredits||[]).map(credit=>credit.name)].map(normalize))].sort(), normalize(track.albumTitle || ""), Math.round(track.durationMs / 1000), track.versionLabel,track.language,track.alternateTitles]);
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
    const listener = (data: PlayerLyrics) => setResult(previous => previous.key === key ? {...previous, data, error: null, loading: false} : {key, data, error: null, loading: false});
    const listeners = subscribers.get(key) || new Set<(data: PlayerLyrics) => void>();
    listeners.add(listener); subscribers.set(key, listeners);
    return () => {listeners.delete(listener); if (!listeners.size) subscribers.delete(key);};
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
          // A second view can finish its IndexedDB lookup just after the first
          // request completed. Recheck the shared value before starting work.
          const shared=memory.get(thisKey),sharedMissing=missingMemory.get(thisKey);
          if(!explicitRefresh&&shared&&lyricCacheFresh(shared.data.timing,lyricProviderCheckedAt(shared)))return shared.data;
          if(!explicitRefresh&&sharedMissing&&lyricCacheFresh("missing",sharedMissing.checkedAt))throw new UserFacingError(sharedMissing.issue,404);
          const publicationBefore=publicationVersions.get(thisKey)||0;
          const query = new URLSearchParams({ recordingId: input.id, title: input.title });
          for (const artist of input.artists.length ? input.artists : [""]) query.append("artist", artist);
          if (input.durationMs > 0) query.set("duration", String(input.durationMs / 1000));
          if (input.albumTitle) query.set("album", input.albumTitle);
          if(input.versionLabel)query.set("version",input.versionLabel);
          for(const title of input.alternateTitles||[])query.append("alternateTitle",title);
          if(explicitRefresh||cached||missing)query.set("refresh","1");
          const response = await fetch(`/api/v2/lyrics?${query}`, {credentials: "same-origin",cache:"no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(LYRIC_REQUEST_TIMEOUT_MS)])});
          let payload: PlayerLyrics;
          try {payload = await readJsonResponse<PlayerLyrics>(response, {context: "lyrics"});}
          catch (error) {
            if(error instanceof UserFacingError&&error.status===404){signal.throwIfAborted();const previous=memory.get(thisKey);
              if(previous)await writeCache({...previous,savedAt:Date.now(),checkedAt:Date.now()});
              else if((publicationVersions.get(thisKey)||0)===publicationBefore)await writeMissingCache(thisKey,error.issue);
            }
            throw error instanceof UserFacingError ? new LyricLoadError(error, lyricRetryAfter(response.headers.get("Retry-After"))) : error;
          }
          if (!validLines(payload.lines) || !["synced", "plain"].includes(payload.timing) || (!payload.instrumental && !payload.lines.some(line => line.text.trim()))) throw new Error("Lyrics provider returned an invalid response.");
          const data: PlayerLyrics = { lines: payload.lines, timing: payload.timing, provider: payload.provider, providerTrackId: payload.providerTrackId, instrumental: payload.instrumental, schemaVersion: payload.schemaVersion,
            ...(payload.autoSyncEvidence?{autoSyncEvidence:payload.autoSyncEvidence}:{}),
            readingLanguage: lyricReadingLanguage(payload.lines.map(line=>line.text).join("\n"),input.language),
            hasJapanese: payload.lines.some((line: PlayerLyricLine) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) };
          signal.throwIfAborted();
          // A pre-publication provider request can finish after the upload. It
          // must never overwrite the freshly read LRCLIB result on this device.
          if((publicationVersions.get(thisKey)||0)!==publicationBefore&&memory.get(thisKey))return memory.get(thisKey)!.data;
          await writeCache({ key: thisKey, savedAt: Date.now(),checkedAt:Date.now(), data });
          return memory.get(thisKey)!.data;
        });
        release = request.release;
        const data = await request.promise;
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
    if(!payload){setRefreshKey(key);setRetryVersion(version=>version+1);return;}
    if(!validLines(payload.lines)||payload.schemaVersion!==VERIFIED_LYRICS_VERSION||!payload.lines.some(line=>line.text.trim()))throw new Error("Published lyrics did not match a valid provider response.");
    const data={...payload,hasJapanese:payload.lines.some(line=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)),readingLanguage:lyricReadingLanguage(payload.lines.map(line=>line.text).join("\n"),input.language)};
    publicationVersions.set(key,(publicationVersions.get(key)||0)+1);
    await writeCache({key,savedAt:Date.now(),checkedAt:Date.now(),data});
  },[input,key]);
  const setReadingLanguage=useCallback(async(language:ReadingLanguage)=>{
    if(!key)return;
    const cached=await readCache(key);
    if(!cached)return;
    await writeCache({key,savedAt:Date.now(),data:chooseReadingLanguage(cached.data,language,rememberReadingGuides(cached.guides,cached.data))});
  },[key]);
  const applyAutoSync=useCallback(async(lines:TimedLyric[],evidence:AutoSyncEvidence)=>{
    if(!key)return;
    const source=(await readCache(key))?.data;
    if(!source||source.timing!=="plain"||!validLines(lines)||lines.length!==source.lines.length||lines.some((line,index)=>line.text!==source.lines[index].text))throw new Error("The sync result no longer matches these plain lyrics.");
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(source.lines.map(line=>line.text))));
    const sourceContentKey=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(evidence.sourceContentKey!==sourceContentKey||evidence.engine!=="whisper-small-en-v1"||!Number.isFinite(evidence.confidence)||evidence.confidence<0||evidence.confidence>1||!/^[a-f0-9]{64}$/.test(evidence.audioSha256))throw new Error("The sync evidence does not match this recording's lyrics.");
    // Preserve readings by source line while replacing only verified timing.
    const updated=lines.map((line,index)=>({...source.lines[index],...line}));
    publicationVersions.set(key,(publicationVersions.get(key)||0)+1);
    await writeCache({key,savedAt:Date.now(),data:{...source,lines:updated,timing:"synced",autoSyncEvidence:evidence}});
  },[key]);
  const getJapaneseReadings = useCallback(async (requestedLanguage?:ReadingLanguage) => {
    if (!input || !key) return;
    const cached=await readCache(key),source=cached?.data;
    const language=requestedLanguage||source?.readingLanguage||"ja",engine=readingEngine(language);
    if (!source || source.lines.every(line => !line.text || line.readingEngine === engine && typeof line.romanized === "string")) return;
    const prepared=chooseReadingLanguage(source,language,rememberReadingGuides(cached?.guides,source));
    if(prepared.lines.every(line=>!line.text.trim()||typeof line.romanized==="string"&&line.readingEngine===engine)){await writeCache({key,savedAt:Date.now(),data:prepared});return;}
    if(browserOffline())throw new Error("This reading guide has not been saved yet. Reconnect once to prepare it for offline listening.");
    // The full lyric content is part of the flight identity, so an edited provider
    // response can never join an older pronunciation request.
    const content = JSON.stringify(source.lines.map(line=>line.text));
    const request = readingFlights.acquire(key + language + content, async signal => {
      const payload = await requestJson<{engine:string;lines:PlayerLyricLine[]}>("/api/v2/readings", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: input.id, language, lines: source.lines }) },{context:"lyrics"});
      if (payload.engine !== engine || !validLines(payload.lines) || payload.lines.length !== source.lines.length || payload.lines.some((line, index) => line.text !== source.lines[index].text || line.start !== source.lines[index].start || line.end !== source.lines[index].end || JSON.stringify(line.words) !== JSON.stringify(source.lines[index].words) || typeof line.romanized !== "string" || line.readingEngine !== engine)) throw new Error("The reading guide did not match these lyrics.");
      const latest = memory.get(key)?.data;
      if (latest && JSON.stringify(latest.lines.map(line=>line.text)) !== content) return latest;
      const guideData={...source,readingLanguage:language,lines:payload.lines};
      const guides=rememberReadingGuides(memory.get(key)?.guides,guideData);
      const data=latest?.readingLanguage&&latest.readingLanguage!==language?latest:chooseReadingLanguage(latest||source,language,guides);
      await writeCache({key, savedAt: Date.now(), data,guides});
      return data;
    });
    try {await request.promise;} finally {request.release();}
  }, [input, key]);
  return { data: result.key === key ? result.data : null, loading: Boolean(track) && (result.key !== key || result.loading), error: result.key === key ? result.error : null, getJapaneseReadings,setReadingLanguage,applyPublishedLyrics,applyAutoSync,retry:()=>{setRefreshKey(key);setRetryVersion(v=>v+1);} };
}
