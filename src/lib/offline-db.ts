import { openDB, IDBPDatabase } from "idb";

const DB_NAME = "sakura-offline";
const DB_VERSION = 1;

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
      cached: boolean;
    };
    indexes: { "by-artist": string };
  };
  playlists: {
    key: string;
    value: { id: string; name: string; trackIds: string[] };
  };
  settings: {
    key: string;
    value: { key: string; value: any };
  };
}

let dbPromise: Promise<IDBPDatabase<SakuraDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SakuraDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
        trackStore.createIndex("by-artist", "artist");
        db.createObjectStore("playlists", { keyPath: "id" });
        db.createObjectStore("settings", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

export async function saveTrackOffline(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  audioUrl: string;
  coverUrl?: string;
}) {
  const db = await getDB();
  await db.put("tracks", { ...track, cached: true });
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
}

export async function isTrackCached(id: string): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  return track?.cached ?? false;
}

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

export async function saveSetting(key: string, value: any) {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function getSetting(key: string) {
  const db = await getDB();
  const result = await db.get("settings", key);
  return result?.value;
}

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
}
