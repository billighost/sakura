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

/**
 * ── Why downloads are scoped to the device, not to the user ─────────────────
 *
 * A download is a file on this phone. It costs *this device's* storage and it
 * was paid for with *this device's* data, so "who was signed in when it landed"
 * is provenance, not ownership.
 *
 * Scoping reads by `(userId, deviceId)` — which is what this module used to do —
 * made that file invisible the moment the signed-in user changed, in three ways
 * that all look like data loss to the person holding the phone:
 *
 *   1. Download while signed out (`userId` is `"anon"`), then sign in: every
 *      track vanishes from Downloads, and the audio is still on the device
 *      taking up space with no way to reach it.
 *   2. Switch accounts: same disappearance, in both directions.
 *   3. A shared device: two people download twenty songs each, and each sees
 *      only their own — while the storage bill is the sum of both.
 *
 * So reads match on `deviceId` alone. Writes still record `userId`, because
 * knowing who fetched a file is occasionally useful and costs nothing; nothing
 * reads it as a filter any more.
 *
 * Existing rows are left exactly where they are. The audio store's keys are
 * `${userId}:${deviceId}:${trackId}`, so a blob saved under `anon:` has to stay
 * reachable after sign-in — `resolveAudioKey` does that by falling back to a
 * suffix match on the key list. That's deliberately preferred over rewriting
 * keys in an IndexedDB upgrade: a migration would have to read and re-put every
 * audio blob on the device, which is minutes of main-thread work and a real risk
 * of hitting quota mid-rewrite, to buy nothing a cheap lookup can't.
 */

/**
 * Find the audio store key holding this track's blob, whoever downloaded it.
 *
 * Fast path is the exact key for the current user. The scan only runs on a miss
 * and only reads *keys* — never the blobs — so it stays cheap even on a device
 * with hundreds of downloads.
 */
async function resolveAudioKey(
  store: "audio" | "partial_audio",
  trackId: string,
  userId: string,
  deviceId: string
): Promise<string | null> {
  const db = await getDB();
  const exact = `${userId}:${deviceId}:${trackId}`;

  const keys = (await db.getAllKeys(store)) as string[];
  if (keys.includes(exact)) return exact;

  // Any user on this device will do — the file is the device's.
  const suffix = `:${deviceId}:${trackId}`;
  return keys.find((k) => typeof k === "string" && k.endsWith(suffix)) ?? null;
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
  // Resolve rather than rebuild the key: the blob may have been written while a
  // different account was signed in, and a delete against the wrong prefix
  // matches nothing and silently leaves the file on the device.
  const key = await resolveAudioKey("audio", id, userId, deviceId);
  if (key) await db.delete("audio", key);
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

  const key = await resolveAudioKey("audio", id, userId, deviceId);
  if (key) {
    const result = await db.get("audio", key);
    if (result?.blob) return result.blob;
  }

  // Nothing stored under this id directly. If it's the queued-side id of a
  // track that finished under a resolved one, follow the pointer rather than
  // reporting the track as un-downloaded. Costs one extra read, and only on a
  // miss, so the common path is unchanged.
  const track = await db.get("tracks", id);
  const aliasId = track?.blobId;
  if (aliasId && aliasId !== id) {
    const aliasKey = await resolveAudioKey("audio", aliasId, userId, deviceId);
    if (aliasKey) {
      const aliased = await db.get("audio", aliasKey);
      return aliased?.blob;
    }
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
  // Device-scoped so a download interrupted before sign-in resumes afterwards
  // rather than restarting from byte zero.
  const key = await resolveAudioKey("partial_audio", id, userId, deviceId);
  if (!key) return undefined;
  return db.get("partial_audio", key);
}

export async function removePartialAudio(id: string, userId = getCachedUserId(), deviceId = getDeviceId()) {
  const db = await getDB();
  const key = await resolveAudioKey("partial_audio", id, userId, deviceId);
  if (key) await db.delete("partial_audio", key);
}

export async function isTrackDownloaded(id: string, userId = getCachedUserId(), deviceId = getDeviceId()): Promise<boolean> {
  const db = await getDB();
  const track = await db.get("tracks", id);
  if (!track) return false;
  // Device-scoped: a file on this device counts as downloaded no matter which
  // account fetched it. See the scoping note above.
  return track.deviceId === deviceId;
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
  // Everything downloaded on this device, whoever was signed in at the time.
  return all.filter(t => t.deviceId === deviceId);
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
   *
   * Matching is device-scoped for the same reason reads are: the row being
   * deleted may well have been written under a different account, and a delete
   * that silently skipped it would leave a row the UI still shows and a blob
   * nothing can reach.
   */
  const record = await db.get("tracks", id);
  const audioOwnerId = record?.blobId ?? id;

  const all = await db.getAll("tracks");
  const affected = all.filter(
    (t) =>
      t.deviceId === deviceId &&
      (t.id === id || t.id === audioOwnerId || t.blobId === audioOwnerId),
  );

  // Delete blobs by resolved key so a row written under another account's id
  // prefix is actually removed rather than leaking storage.
  for (const trackId of new Set([id, audioOwnerId, ...affected.map((t) => t.id)])) {
    const audioKey = await resolveAudioKey("audio", trackId, userId, deviceId);
    if (audioKey) await db.delete("audio", audioKey);
    const partialKey = await resolveAudioKey("partial_audio", trackId, userId, deviceId);
    if (partialKey) await db.delete("partial_audio", partialKey);
  }

  for (const t of affected) {
    await db.delete("tracks", t.id);
  }

  // Guard the case where the id had no metadata row at all.
  await db.delete("tracks", id);
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
    /*
     * The service worker's audio cache is version-suffixed (`sakura-audio-v5`
     * — see public/sw.js), so deleting the bare name matched nothing and every
     * "remove downloads" left the Cache Storage copies behind. On a device
     * where someone had cleared downloads to reclaim space, the space was
     * never actually reclaimed. Match by prefix so it also catches entries
     * left by an older worker version.
     */
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("sakura-audio")).map((k) => caches.delete(k))
    );
  }
  const db = await getDB();

  /**
   * Device-scoped, matching what the Downloaded page shows.
   *
   * This is reached from a "Remove all downloads?" confirmation whose stated
   * promise is "this frees up space on your phone". Filtering by `userId` broke
   * that promise twice over: rows saved under a previous account survived while
   * being listed as removed, and — worse — their blobs stayed on disk, so the
   * space the user cleared downloads to reclaim was never actually reclaimed.
   */
  const tx = db.transaction("tracks", "readwrite");
  const tracks = await tx.store.getAll();
  for (const t of tracks) {
    if (t.deviceId === deviceId) {
      await tx.store.delete(t.id);
    }
  }
  await tx.done;

  // Keys are `${userId}:${deviceId}:${trackId}`, so match on the device segment
  // to catch blobs written under any account that used this device.
  const deviceSegment = `:${deviceId}:`;

  const tx2 = db.transaction("audio", "readwrite");
  const audioKeys = await tx2.store.getAllKeys();
  for (const key of audioKeys) {
    if (typeof key === "string" && key.includes(deviceSegment)) {
      await tx2.store.delete(key);
    }
  }
  await tx2.done;

  // Half-finished downloads hold chunks too, and leaving them behind meant
  // "remove all" could free far less than the user expected.
  const tx3 = db.transaction("partial_audio", "readwrite");
  const partialKeys = await tx3.store.getAllKeys();
  for (const key of partialKeys) {
    if (typeof key === "string" && key.includes(deviceSegment)) {
      await tx3.store.delete(key);
    }
  }
  await tx3.done;

  await clearLibraryCache(userId);
}
