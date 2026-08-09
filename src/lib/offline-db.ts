import { openDB, IDBPDatabase } from "idb";

const DB_NAME = "sakura-offline";
const DB_VERSION = 4;

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
      // Scoped keys for user & device isolation
      userId?: string;
      deviceId?: string;
      /**
       * Where this track's audio actually lives, when it isn't under this id.
       *
       * A virtual `deezer-<id>` track becomes a real database id once Telegram
       * has served the file, so the download finishes under a different id than
       * the one that was queued. Both ids need to resolve — the queued one
       * because that's what the row in the UI and the play queue still hold.
       * Recording the real id here lets `getAudioBlob` follow the pointer
       * instead of the alternative, which was writing the whole blob a second
       * time under the second id and doubling on-device storage for every
       * download that originated from Deezer.
       */
      blobId?: string;
    };
    indexes: { "by-artist": string; "by-user-device": [string, string] };
  };
  audio: {
    key: string; // compound key: `${userId}:${deviceId}:${trackId}`
    value: { id: string; userId: string; deviceId: string; blob: Blob };
  };
  partial_audio: {
    key: string; // compound key: `${userId}:${deviceId}:${trackId}`
    value: { id: string; userId: string; deviceId: string; chunks: Blob[]; totalBytes: number; downloadedBytes: number };
  };
  playlists: {
    key: string;
    value: { id: string; name: string; trackIds: string[]; userId?: string };
  };
  settings: {
    key: string;
    value: { key: string; value: any };
  };
  libraryCache: {
    key: string; // compound key: `${userId}:${key}`
    value: { key: string; userId: string; data: any; updatedAt: number };
  };
  lyrics: {
    key: string; // trackId or key
    value: { trackId: string; lyrics: any; savedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<SakuraDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SakuraDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
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
        if (oldVersion < 3) {
          // Re-create or adjust stores for version 3 to support compound keys or additional indexes
          if (db.objectStoreNames.contains("lyrics")) {
            db.deleteObjectStore("lyrics");
          }
          db.createObjectStore("lyrics", { keyPath: "trackId" });

          // Add a user-device index to tracks store to query only this device's songs
          if (db.objectStoreNames.contains("tracks")) {
            const store = transaction.objectStore("tracks");
            if (!store.indexNames.contains("by-user-device")) {
              store.createIndex("by-user-device", ["userId", "deviceId"]);
            }
          }
        }
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains("partial_audio")) {
            db.createObjectStore("partial_audio", { keyPath: "id" });
          }
        }
      },
    });
  }
  return dbPromise;
}

// Get device identifier
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let deviceId = localStorage.getItem("sakura-device-id");
  if (!deviceId) {
    deviceId = "dev-" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("sakura-device-id", deviceId);
  }
  return deviceId;
}

// Helpers to get currently active user ID
export function getCachedUserId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    const saved = localStorage.getItem("sakura-user-id");
    return saved || "anon";
  } catch {
    return "anon";
  }
}

export function setCachedUserId(userId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sakura-user-id", userId);
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
  blobId?: string;
}, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  await db.put("tracks", {
    ...track,
    savedAt: Date.now(),
    userId,
    deviceId
  });
}

export async function getOfflineTrack(id: string) {
  const db = await getDB();
  return db.get("tracks", id);
}

export async function getAllOfflineTracks() {
  const db = await getDB();
  return db.getAll("tracks");
}

export async function removeOfflineTrack(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  await db.delete("tracks", id);
  await db.delete("audio", `${userId}:${deviceId}:${id}`);
}

export async function isTrackCached(id: string): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  return !!track;
}

export async function saveAudioBlob(id: string, blob: Blob, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = `${userId}:${deviceId}:${id}`;
  await db.put("audio", { id: key, userId, deviceId, blob });
}

export async function getAudioBlob(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = `${userId}:${deviceId}:${id}`;
  const result = await db.get("audio", key);
  if (result?.blob) return result.blob;

  // Nothing stored under this id directly. If it's the queued-side id of a
  // track that finished under a resolved one, follow the pointer rather than
  // reporting the track as un-downloaded. Costs one extra read, and only on a
  // miss, so the common path is unchanged.
  const track = await db.get("tracks", id);
  const aliasId = track?.blobId;
  if (aliasId && aliasId !== id) {
    const aliased = await db.get("audio", `${userId}:${deviceId}:${aliasId}`);
    return aliased?.blob;
  }

  return undefined;
}

export async function savePartialAudio(id: string, chunks: Blob[], totalBytes: number, downloadedBytes: number, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = `${userId}:${deviceId}:${id}`;
  await db.put("partial_audio", { id: key, userId, deviceId, chunks, totalBytes, downloadedBytes });
}

export async function getPartialAudio(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = `${userId}:${deviceId}:${id}`;
  return db.get("partial_audio", key);
}

export async function removePartialAudio(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = `${userId}:${deviceId}:${id}`;
  await db.delete("partial_audio", key);
}

export async function isTrackDownloaded(id: string, userId = getCachedUserId(), deviceId = getDeviceId()): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  if (!track) return false;
  // Verify it belongs to this specific user & device
  return track.userId === userId && track.deviceId === deviceId;
}

export async function findDownloadedTrackByMetadata(
  title: string,
  artist: string,
  userId = getCachedUserId(),
  deviceId = getDeviceId()
) {
  const db = await getDB();
  const all = await db.getAll("tracks");
  const normTitle = title.toLowerCase().trim();
  const normArtist = artist.toLowerCase().trim();

  return all.find(
    (t) =>
      t.userId === userId &&
      t.deviceId === deviceId &&
      t.title.toLowerCase().trim() === normTitle &&
      t.artist.toLowerCase().trim() === normArtist
  );
}

export async function cloneDownloadedTrack(
  existingTrackId: string,
  newTrackId: string,
  newTrackData: { title: string; artist: string; album?: string; coverUrl?: string; duration: number; audioUrl: string },
  userId = getCachedUserId(),
  deviceId = getDeviceId()
) {
  const db = await getDB();
  const blob = await getAudioBlob(existingTrackId, userId, deviceId);
  if (!blob) return false;

  // Point at the existing audio instead of copying it. This path exists because
  // the same recording can already be on the device under a different id, so
  // copying would store a second full copy of a file we demonstrably already
  // have — the one case where the duplicate is most obviously avoidable.
  //
  // If the source is itself an alias, point at its target rather than at the
  // alias, so a chain never forms and one lookup always resolves.
  const sourceRecord = await db.get("tracks", existingTrackId);
  const target = sourceRecord?.blobId ?? existingTrackId;

  await saveTrackOffline({
    id: newTrackId,
    title: newTrackData.title,
    artist: newTrackData.artist,
    album: newTrackData.album,
    coverUrl: newTrackData.coverUrl,
    audioUrl: newTrackData.audioUrl,
    duration: newTrackData.duration,
    blobId: target === newTrackId ? undefined : target,
  }, userId, deviceId);

  return true;
}

export async function getAllDownloadedTracks(userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const all = await db.getAll("tracks");
  return all.filter(t => t.userId === userId && t.deviceId === deviceId);
}

export async function removeDownloadedTrack(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();

  /**
   * Deleting a track's audio has to account for other ids pointing at it.
   *
   * Since a Deezer-sourced download stores metadata under the queued id and the
   * audio under the resolved one, deleting either id alone leaves the other
   * half behind: delete the alias and the blob is orphaned with nothing
   * referencing it; delete the target and every alias silently resolves to
   * nothing while still appearing downloaded.
   *
   * So resolve to whichever id owns the audio, remove that blob, then remove
   * every metadata row that referred to it — the alias and the target alike.
   */
  const record = await db.get("tracks", id);
  const audioOwnerId = record?.blobId ?? id;

  const all = await db.getAll("tracks");
  const affected = all.filter(
    (t) =>
      t.userId === userId &&
      t.deviceId === deviceId &&
      (t.id === id || t.id === audioOwnerId || t.blobId === audioOwnerId),
  );

  await db.delete("audio", `${userId}:${deviceId}:${audioOwnerId}`);
  await db.delete("partial_audio", `${userId}:${deviceId}:${audioOwnerId}`);

  for (const t of affected) {
    await db.delete("tracks", t.id);
    await db.delete("audio", `${userId}:${deviceId}:${t.id}`);
  }

  // Guard the case where the id had no metadata row at all.
  await db.delete("tracks", id);
  await db.delete("audio", `${userId}:${deviceId}:${id}`);
}

// --- Library cache (stale-while-revalidate for instant page loads) ---

export async function getCachedLibraryData<T>(key: string, userId = getCachedUserId()): Promise<T | null> {
  try {
    const db = await getDB();
    const cacheKey = `${userId}:${key}`;
    const cached = await db.get("libraryCache", cacheKey);
    if (!cached) return null;
    return cached.data as T;
  } catch {
    return null;
  }
}

export async function setCachedLibraryData(key: string, data: any, userId = getCachedUserId()): Promise<void> {
  try {
    const db = await getDB();
    const cacheKey = `${userId}:${key}`;
    await db.put("libraryCache", { key: cacheKey, userId, data, updatedAt: Date.now() });
  } catch {}
}

export async function clearLibraryCache(userId = getCachedUserId()): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction("libraryCache", "readwrite");
    // Clear only this user's library caches
    const keys = await tx.store.getAllKeys();
    for (const k of keys) {
      if (typeof k === "string" && k.startsWith(`${userId}:`)) {
        await tx.store.delete(k);
      }
    }
    await tx.done;
  } catch {}
}

// --- Playlist offline ---

export async function savePlaylistOffline(playlist: {
  id: string;
  name: string;
  trackIds: string[];
}, userId = getCachedUserId()) {
  const db = await getDB();
  await db.put("playlists", { ...playlist, userId });
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

// --- Lyrics Cache ---

export async function getCachedLyrics(trackId: string) {
  try {
    const db = await getDB();
    const cached = await db.get("lyrics", trackId);
    if (!cached) return null;
    return cached.lyrics;
  } catch {
    return null;
  }
}

export async function setCachedLyrics(trackId: string, lyrics: any) {
  try {
    const db = await getDB();
    await db.put("lyrics", { trackId, lyrics, savedAt: Date.now() });
  } catch {}
}

// --- Storage ---

export async function getStorageEstimate() {
  if ("storage" in navigator && "estimate" in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return { used: estimate.usage || 0, quota: estimate.quota || 0 };
  }
  return { used: 0, quota: 0 };
}

export async function clearAudioCache(userId = getCachedUserId(), deviceId = getDeviceId()) {
  if ("caches" in window) {
    await caches.delete("sakura-audio");
  }
  const db = await getDB();
  // Clear only this device & user's tracks/audio
  const tx = db.transaction("tracks", "readwrite");
  const tracks = await tx.store.getAll();
  for (const t of tracks) {
    if (t.userId === userId && t.deviceId === deviceId) {
      await tx.store.delete(t.id);
    }
  }
  await tx.done;

  const tx2 = db.transaction("audio", "readwrite");
  const audioKeys = await tx2.store.getAllKeys();
  for (const key of audioKeys) {
    if (typeof key === "string" && key.startsWith(`${userId}:${deviceId}:`)) {
      await tx2.store.delete(key);
    }
  }
  await tx2.done;

  await clearLibraryCache(userId);
}
