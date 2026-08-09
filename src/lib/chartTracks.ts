import { cacheGet, cacheSet, cacheKey } from "./cache";

/**
 * Display metadata for chart entries that have no `Track` row.
 *
 * WHY CHARTS SHOULD NOT MATERIALISE TRACKS
 * ----------------------------------------
 * A Top 50 refresh used to INSERT a `Track` row for every charted song the
 * library didn't already own, with `audioUrl = 'pending'` — a row that exists
 * only so the playlist has something to point at, and that can never be played.
 * Measured on this database, 102 of 196 tracks were such placeholders, 88 of
 * them referenced by nothing but a chart.
 *
 * That is a per-day cost, not a one-off: five charts × 50 entries refreshed
 * daily, each new entry a fresh row at ~1.2KB with eleven indexes on the table.
 * A year of chart churn is tens of thousands of unplayable rows — on a 500MB
 * budget shared with everything else.
 *
 * So charts now reference `deezer-<id>` directly, and their display metadata
 * lives here instead. Nothing is lost: the chart only needs title, artist,
 * cover and duration to render, and the moment someone actually plays one the
 * existing download path materialises a real `Track` with real audio.
 *
 * This mirrors `virtualTracks.ts`, with one deliberate difference: mixes are
 * per-user so their metadata is keyed per user, whereas a chart is the same
 * for everybody. One global key per chart serves the whole userbase, which is
 * also what keeps the Redis command count flat as users are added.
 */

export interface ChartTrackMeta {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  duration: number;
  deezerId: string;
}

/**
 * Comfortably longer than the daily refresh, so a failed or skipped refresh
 * degrades to slightly stale chart art rather than an empty playlist.
 */
const META_TTL_SECONDS = 7 * 24 * 60 * 60;

function metaKey(systemId: string): string {
  return cacheKey("chartmeta", systemId);
}

export function isVirtualChartId(id: string): boolean {
  return id.startsWith("deezer-");
}

export function virtualIdFor(deezerId: string | number): string {
  return `deezer-${deezerId}`;
}

/**
 * Replace the stored metadata for a chart.
 *
 * Replace rather than merge: a chart is a complete snapshot of a Top 50, and
 * merging would accumulate every song that has ever charted until the key grew
 * without bound.
 */
export async function setChartTrackMeta(
  systemId: string,
  tracks: ChartTrackMeta[],
): Promise<void> {
  if (tracks.length === 0) return;
  const map: Record<string, ChartTrackMeta> = {};
  for (const t of tracks) map[t.id] = t;
  await cacheSet(metaKey(systemId), map, META_TTL_SECONDS);
}

export async function getChartTrackMeta(
  systemId: string,
): Promise<Record<string, ChartTrackMeta>> {
  return (await cacheGet<Record<string, ChartTrackMeta>>(metaKey(systemId))) ?? {};
}

/**
 * Render a chart's id list, merging real rows with virtual metadata.
 *
 * Order is taken from `trackIds` because chart position is the whole point of a
 * Top 50. Resolution is by lookup, never by the shape of the id: the download
 * path creates real `Track` rows whose ids begin with `deezer-`, so treating
 * that prefix as "virtual" drops real entries — it removed 23 of 31 songs from
 * the community chart before this was fixed.
 *
 * An id matching neither a row nor cached metadata is skipped. That happens
 * when metadata expired while the playlist row survived, and a slightly shorter
 * chart beats one with holes in it.
 */
export function mergeChartTracks(
  trackIds: string[],
  realRows: Map<string, any>,
  meta: Record<string, ChartTrackMeta>,
): any[] {
  const out: any[] = [];
  for (const id of trackIds) {
    const real = realRows.get(id);
    if (real) {
      out.push(real);
      continue;
    }
    const m = meta[id];
    if (m) {
      out.push({
        id: m.id,
        title: m.title,
        duration: m.duration,
        audioUrl: null,
        coverUrl: m.coverUrl,
        artist: { name: m.artist },
        album: { title: null, coverUrl: m.coverUrl },
        isVirtual: true,
        deezerId: m.deezerId,
      });
    }
  }
  return out;
}
