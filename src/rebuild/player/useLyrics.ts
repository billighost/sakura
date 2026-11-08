"use client";
import { useEffect, useMemo, useState } from "react";
import type { MusicTrack } from "../app/types";
import type { TimedLyric } from "../lyrics/parse";
import { JAPANESE_READING_VERSION, VERIFIED_LYRICS_VERSION } from "../lyrics/versions";
import { requestJson, userMessage } from "../app/errors";
import { LyricFlights } from "./lyricFlight";

export interface PlayerLyricLine extends TimedLyric { romanized?: string; readingReviewNeeded?: boolean; readingEngine?: string }
export interface PlayerLyrics {
  lines: PlayerLyricLine[];
  timing: "synced" | "plain";
  provider: string;
  providerTrackId: number;
  instrumental?: boolean;
  schemaVersion: string;
  hasJapanese: boolean;
}
type CacheValue = { key: string; savedAt: number; data: PlayerLyrics };
type LyricInput = Pick<MusicTrack, "id" | "title" | "artists" | "albumTitle" | "durationMs">;
const memory = new Map<string, CacheValue>();
const flights = new LyricFlights<PlayerLyrics>();
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => { database = undefined; throw error; });
  return database;
}
async function readCache(key: string) {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const db = await openDatabase();
    return await new Promise<CacheValue | undefined>((resolve) => {
      const request = db.transaction("lyrics", "readonly").objectStore("lyrics").get(key);
      request.onsuccess = () => {
        const value = request.result as CacheValue | undefined;
        if (value?.key === key && Number.isFinite(value.savedAt) && validLines(value.data?.lines)) { memory.set(key, value); resolve(value); }
        else resolve(undefined);
      };
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
async function writeCache(value: CacheValue) {
  memory.set(value.key, value);
  while (memory.size > 128) memory.delete(memory.keys().next().value!);
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("lyrics", "readwrite");
      tx.objectStore("lyrics").put(value);
      const count = tx.objectStore("lyrics").count();
      count.onsuccess = () => {
        if (count.result <= 128) return;
        let excess = count.result - 128;
        const cursor = tx.objectStore("lyrics").openCursor();
        cursor.onsuccess = () => { if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue(); } };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* Lyrics still work when device storage is full or disabled. */ }
}
export function lyricInputKey(track: LyricInput) {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return JSON.stringify([VERIFIED_LYRICS_VERSION, JAPANESE_READING_VERSION, normalize(track.title), [...new Set(track.artists.map(normalize))].sort(), normalize(track.albumTitle || ""), Math.round(track.durationMs / 1000)]);
}
export function useLyrics(track: MusicTrack | null) {
  const [retryVersion,setRetryVersion]=useState(0);
  const [result, setResult] = useState<{ key: string; data: PlayerLyrics | null; error: string | null; loading: boolean }>({ key: "", data: null, error: null, loading: false });
  const key = track ? lyricInputKey(track) : "";
  // The player can replace a catalog object while resolving it. Equal lyric
  // metadata must keep the same subscription instead of canceling and fetching.
  const input = useMemo<LyricInput | null>(() => {
    if (!key) return null;
    return { id: track!.id, title: track!.title, artists: [...track!.artists], albumTitle: track!.albumTitle, durationMs: track!.durationMs };
  // The normalized key intentionally keeps this object stable when catalog
  // resolution only replaces a temporary recording ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const thisKey = lyricInputKey(input);
    void (async () => {
      const cached = await readCache(thisKey);
      if (controller.signal.aborted) return;
      if (cached) setResult({ key: thisKey, data: cached.data, error: null, loading: false });
      if (cached && retryVersion===0 && Date.now() - cached.savedAt < 7 * 24 * 60 * 60 * 1000) return;
      if (!cached) setResult({ key: thisKey, data: null, error: null, loading: true });
      try {
        const request = flights.acquire(thisKey, async signal => {
          const query = new URLSearchParams({ recordingId: input.id, title: input.title });
          for (const artist of input.artists.length ? input.artists : [""]) query.append("artist", artist);
          if (input.durationMs > 0) query.set("duration", String(input.durationMs / 1000));
          if (input.albumTitle) query.set("album", input.albumTitle);
          const payload = await requestJson<PlayerLyrics>(`/api/v2/lyrics?${query}`, { signal },{context:"lyrics"});
          if (!validLines(payload.lines)) throw new Error("Lyrics provider returned an invalid response.");
          const data: PlayerLyrics = { lines: payload.lines, timing: payload.timing, provider: payload.provider, providerTrackId: payload.providerTrackId, instrumental: payload.instrumental, schemaVersion: payload.schemaVersion,
            hasJapanese: payload.lines.some((line: PlayerLyricLine) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) };
          signal.throwIfAborted();
          void writeCache({ key: thisKey, savedAt: Date.now(), data });
          return data;
        });
        release = request.release;
        const data = await request.promise;
        if (controller.signal.aborted) return;
        setResult({ key: thisKey, data, error: null, loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ key: thisKey, data: cached?.data || null, error: cached ? null : userMessage(error,"lyrics"), loading: false });
      }
    })();
    return () => { controller.abort(); release?.(); };
  }, [key, input, retryVersion]);
  async function getJapaneseReadings() {
    if (!track || result.key !== key || !result.data) return;
    if (result.data.lines.every((line) => !line.text || line.romanized !== undefined)) return;
    const payload = await requestJson<{engine:string;lines:PlayerLyricLine[]}>("/api/v2/readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId: track.id, language: "ja", lines: result.data.lines }) },{context:"lyrics"});
    if (payload.engine !== JAPANESE_READING_VERSION || !Array.isArray(payload.lines) || payload.lines.length !== result.data.lines.length || payload.lines.some((line: PlayerLyricLine, index: number) => line.text !== result.data!.lines[index].text || line.start !== result.data!.lines[index].start || line.end !== result.data!.lines[index].end || JSON.stringify(line.words) !== JSON.stringify(result.data!.lines[index].words))) throw new Error("The reading guide did not match these lyrics.");
    const data = { ...result.data, lines: payload.lines as PlayerLyricLine[] };
    setResult((previous) => previous.key === key ? { ...previous, data } : previous);
    await writeCache({ key, savedAt: Date.now(), data });
  }
  return { data: result.key === key ? result.data : null, loading: Boolean(track) && (result.key !== key || result.loading), error: result.key === key ? result.error : null, getJapaneseReadings,retry:()=>setRetryVersion(v=>v+1) };
}
