/**
 * Metadata sidecar for virtual (not-yet-materialised) tracks.
 *
 * A generated mix can reference a track that has no `Track` row — the whole
 * point of the virtual catalogue. But the mix still has to *render*: title,
 * artist, cover, duration. Re-asking Deezer per track on every page view would
 * be dozens of calls to display one shelf.
 *
 * So the generator writes the display metadata it already fetched into Redis,
 * keyed per user, and the read path merges it with real DB rows. This lives in
 * Redis rather than Postgres deliberately: it is derived, disposable, and
 * expires with the mix that produced it. Losing it costs one regeneration, not
 * data.
 */

import { cacheGet, cacheSet, cacheKey } from "./cache";

export interface VirtualTrackMeta {
  id: string;
  title: string;
  artist: string;
  artistDeezerId: number | null;
  album: string | null;
  coverUrl: string | null;
  duration: number;
}

/** Slightly longer than the 3-day mix TTL so metadata never outlives its mix. */
const META_TTL_SECONDS = 5 * 24 * 60 * 60;

function metaKey(userId: string): string {
  return cacheKey("vtmeta", userId);
}

export function isVirtualId(id: string): boolean {
  return id.startsWith("deezer-");
}

export function virtualDeezerId(id: string): number | null {
  if (!isVirtualId(id)) return null;
  const n = parseInt(id.slice("deezer-".length), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge new entries into the user's metadata map.
 *
 * Read-modify-write rather than a Redis hash: the whole map is small (a few
 * hundred entries at most), it's written once per mix regeneration, and one
 * JSON value keeps the read path to a single round trip — which is the
 * operation that actually happens on every page view.
 */
export async function setVirtualTrackMeta(
  userId: string,
  tracks: VirtualTrackMeta[],
): Promise<void> {
  if (tracks.length === 0) return;

  const key = metaKey(userId);
  const existing = (await cacheGet<Record<string, VirtualTrackMeta>>(key)) ?? {};

  for (const t of tracks) existing[t.id] = t;

  // Bound the map so a user who regenerates mixes for months doesn't grow an
  // unbounded Redis value. Newest wins.
  const entries = Object.entries(existing);
  const trimmed =
    entries.length > 1200
      ? Object.fromEntries(entries.slice(entries.length - 1200))
      : existing;

  await cacheSet(key, trimmed, META_TTL_SECONDS);
}

export async function getVirtualTrackMeta(
  userId: string,
  ids: string[],
): Promise<Map<string, VirtualTrackMeta>> {
  const virtualIds = ids.filter(isVirtualId);
  if (virtualIds.length === 0) return new Map();

  const map = (await cacheGet<Record<string, VirtualTrackMeta>>(metaKey(userId))) ?? {};
  const out = new Map<string, VirtualTrackMeta>();
  for (const id of virtualIds) {
    const meta = map[id];
    if (meta) out.set(id, meta);
  }
  return out;
}

/** Shape a catalogue result for storage. */
export function toMeta(t: {
  id: string;
  title: string;
  artistName: string;
  artistDeezerId: number | null;
  albumTitle: string | null;
  coverUrl: string | null;
  duration: number;
}): VirtualTrackMeta {
  return {
    id: t.id,
    title: t.title,
    artist: t.artistName,
    artistDeezerId: t.artistDeezerId,
    album: t.albumTitle,
    coverUrl: t.coverUrl,
    duration: t.duration,
  };
}
