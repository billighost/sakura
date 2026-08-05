import { openDB, IDBPDatabase } from "idb";

const DB_NAME = "sakura-offline";
const DB_VERSION = 2;

interface SakuraDB {
  tracks: {
    key: string;
    value: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      audioUrl: string;
      coverUrl?: string;
      duration: number;
      savedAt: number;
    };
    indexes: { "by-artist": string };
  };
  audio: {
    key: string;
    value: { id: string; blob: Blob };
  };
  playlists: {
    key: string;
    value: { id: string; name: string; trackIds: string[] };
  };
  settings: {
    key: string;
    value: { key: string; value: any };
  };
  libraryCache: {
    key: string;
    value: { key: string; data: any; updatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<SakuraDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SakuraDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
          trackStore.createIndex("by-artist", "artist");
          db.createObjectStore("audio", { keyPath: "id" });
          db.createObjectStore("playlists", { keyPath: "id" });
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("audio")) {
            db.createObjectStore("audio", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("libraryCache")) {
            db.createObjectStore("libraryCache", { keyPath: "key" });
          }
        }
      },
    });
  }
  return dbPromise;
}

// --- Offline track management (used by TrackRow) ---

export async function saveTrackOffline(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  audioUrl: string;
  coverUrl?: string;
  duration: number;
}) {
  const db = await getDB();
  await db.put("tracks", { ...track, savedAt: Date.now() });
}

export async function getOfflineTrack(id: string) {
  const db = await getDB();
  return db.get("tracks", id);
}

export async function getAllOfflineTracks() {
  const db = await getDB();
  return db.getAll("tracks");
}

export async function removeOfflineTrack(id: string) {
  const db = await getDB();
  await db.delete("tracks", id);
  await db.delete("audio", id);
}

export async function isTrackCached(id: string): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  return !!track;
}

export async function saveAudioBlob(id: string, blob: Blob) {
  const db = await getDB();
  await db.put("audio", { id, blob });
}

export async function getAudioBlob(id: string) {
  const db = await getDB();
  const result = await db.get("audio", id);
  return result?.blob;
}

export async function isTrackDownloaded(id: string): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  return !!track;
}

export async function getAllDownloadedTracks() {
  const db = await getDB();
  return db.getAll("tracks");
}

export async function removeDownloadedTrack(id: string) {
  const db = await getDB();
  await db.delete("tracks", id);
  await db.delete("audio", id);
}

// --- Library cache (stale-while-revalidate for instant page loads) ---

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedLibraryData<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    const cached = await db.get("libraryCache", key);
    if (!cached) return null;
    return cached.data as T;
  } catch {
    return null;
  }
}

export async function setCachedLibraryData(key: string, data: any): Promise<void> {
  try {
    const db = await getDB();
    await db.put("libraryCache", { key, data, updatedAt: Date.now() });
  } catch {}
}

export async function clearLibraryCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction("libraryCache", "readwrite");
    await tx.store.clear();
    await tx.done;
  } catch {}
}

// --- Playlist offline ---

export async function savePlaylistOffline(playlist: {
  id: string;
  name: string;
  trackIds: string[];
}) {
  const db = await getDB();
  await db.put("playlists", playlist);
}

export async function getOfflinePlaylist(id: string) {
  const db = await getDB();
  return db.get("playlists", id);
}

// --- Settings ---

export async function saveSetting(key: string, value: any) {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function getSetting(key: string) {
  const db = await getDB();
  const result = await db.get("settings", key);
  return result?.value;
}

// --- Storage ---

export async function getStorageEstimate() {
  if ("storage" in navigator && "estimate" in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return { used: estimate.usage || 0, quota: estimate.quota || 0 };
  }
  return { used: 0, quota: 0 };
}

export async function clearAudioCache() {
  if ("caches" in window) {
    await caches.delete("sakura-audio");
  }
  const db = await getDB();
  const tx = db.transaction("tracks", "readwrite");
  await tx.store.clear();
  await tx.done;
  const tx2 = db.transaction("audio", "readwrite");
  await tx2.store.clear();
  await tx2.done;
  await clearLibraryCache();
}
