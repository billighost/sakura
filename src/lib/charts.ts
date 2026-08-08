import { query, queryOne, execute } from './sql';
import { searchDeezerTrack } from './metadata';
import { acquireLock, releaseLock } from './cache';

// Providers Configuration
const PROVIDERS = ['apple', 'deezer', 'lastfm', 'audiomack', 'shazam'];

interface ChartTrack {
  title: string;
  artist: string;
  coverUrl?: string;
}

/**
 * Fallback mechanism across 5 providers for top charts.
 */
export async function fetchTopChartFromProviders(type: string, countryCode = 'us'): Promise<ChartTrack[]> {
  for (const provider of PROVIDERS) {
    try {
      let tracks: ChartTrack[] = [];
      if (provider === 'apple') {
        tracks = await fetchAppleMusicChart(type, countryCode);
      } else if (provider === 'deezer') {
        tracks = await fetchDeezerChart(type);
      } else if (provider === 'lastfm') {
        tracks = [];
      } else if (provider === 'audiomack') {
        tracks = [];
      } else if (provider === 'shazam') {
        tracks = [];
      }

      if (tracks.length > 0) {
        console.log(`[Charts] Successfully fetched ${type} from ${provider}`);
        return tracks.slice(0, 50);
      }
    } catch (err) {
      console.warn(`[Charts] Provider ${provider} failed for ${type}:`, err);
    }
  }
  return [];
}

async function fetchAppleMusicChart(type: string, countryCode: string): Promise<ChartTrack[]> {
  let cc = countryCode;
  if (type === 'nigeria') cc = 'ng';
  if (type === 'africa') cc = 'za';
  if (type === 'global') cc = 'us';
  // 'country' keeps whatever the caller passed — that's the whole point of the
  // playlist. It previously fell through to the 'us' default, so "Top 50 in
  // your Country" was the US chart for every user on the platform.

  const url = `https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/50/songs.json`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error('Apple RSS failed');
  const data = await res.json();

  if (!Array.isArray(data?.feed?.results)) return [];

  return data.feed.results.map((r: any) => ({
    title: r.name,
    artist: r.artistName,
    coverUrl: r.artworkUrl100?.replace('100x100bb', '500x500bb')
  }));
}

async function fetchDeezerChart(type: string): Promise<ChartTrack[]> {
  const url = 'https://api.deezer.com/chart/0/tracks';
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error('Deezer failed');
  const data = await res.json();

  if (!Array.isArray(data?.data)) return [];

  return data.data.map((t: any) => ({
    title: t.title,
    artist: t.artist.name,
    coverUrl: t.album?.cover_big || t.album?.cover_medium
  }));
}

/**
 * Updates or creates a system playlist in the DB
 */
export async function updateSystemPlaylist(systemId: string, name: string, type: string, countryCode?: string) {
  // Atomic acquire. The previous get-then-set let concurrent callers all read
  // "unlocked" and all start the same refresh; at the concurrency this app is
  // sized for that meant several full chart rebuilds racing on the same rows.
  //
  // TTL is 15 minutes, comfortably longer than a cold rebuild, because a lock
  // that expires while the work is still running admits exactly the duplicate
  // it exists to prevent. It's released in `finally` so the normal case doesn't
  // wait for expiry.
  const lockKey = `lock:charts-update:${systemId}`;
  if (!(await acquireLock(lockKey, 900))) {
    console.log(`[Charts] Update for ${systemId} already running. Skipping.`);
    return;
  }

  try {
    let dbTrackIds: string[] = [];

    if (type === 'community') {
      const topRows = await query(`
        SELECT "trackId" 
        FROM "ListeningHistory"
        WHERE "playedAt" > NOW() - INTERVAL '7 days'
        GROUP BY "trackId"
        ORDER BY COUNT(*) DESC
        LIMIT 50
      `);
      dbTrackIds = topRows.map(r => r.trackId);
    } else {
      const chartTracks = await fetchTopChartFromProviders(type, countryCode);
      if (chartTracks.length === 0) return null;

      // Resolve all 50 chart entries against the DB in ONE round trip.
      //
      // This was a sequential loop doing a SELECT per chart entry, then an
      // artist INSERT and a track INSERT for each miss — up to ~150 serial
      // round trips per chart, five charts per refresh. At a realistic
      // cross-region RTT that is minutes of wall clock during which the
      // guard lock has already expired. UNNEST lets Postgres match the whole
      // batch at once, so the cost is one round trip regardless of chart size.
      const titles = chartTracks.map((c) => c.title);
      const artists = chartTracks.map((c) => c.artist);

      const matched = await query<{ idx: number; id: string }>(
        `
        SELECT DISTINCT ON (p.idx) p.idx, t.id
        FROM UNNEST($1::text[], $2::text[]) WITH ORDINALITY AS p(title, artist, idx)
        JOIN "Artist" a ON a.name ILIKE p.artist
        JOIN "Track" t ON t."artistId" = a.id AND t.title ILIKE p.title
        ORDER BY p.idx, t."createdAt" ASC
        `,
        [titles, artists]
      );

      const byIdx = new Map<number, string>();
      for (const row of matched) byIdx.set(Number(row.idx), row.id);

      // Chart order is meaningful — it's a Top 50 — so results are collected
      // positionally and compacted at the end rather than pushed as they land.
      const resolved: (string | null)[] = chartTracks.map((_, i) => byIdx.get(i + 1) ?? null);

      const missingIdx = resolved.flatMap((id, i) => (id === null ? [i] : []));

      // Deezer lookups for the misses, bounded so a cold chart doesn't open 50
      // sockets to one provider and get rate-limited into a full failure.
      const DZ_CONCURRENCY = 6;
      const dzResults = new Map<number, Awaited<ReturnType<typeof searchDeezerTrack>>>();
      for (let i = 0; i < missingIdx.length; i += DZ_CONCURRENCY) {
        const slice = missingIdx.slice(i, i + DZ_CONCURRENCY);
        const settled = await Promise.allSettled(
          slice.map((idx) => searchDeezerTrack(chartTracks[idx].title, chartTracks[idx].artist))
        );
        settled.forEach((r, k) => {
          if (r.status === "fulfilled" && r.value) dzResults.set(slice[k], r.value);
        });
      }

      if (dzResults.size > 0) {
        await insertResolvedChartTracks(chartTracks, dzResults, resolved);
      }

      dbTrackIds = resolved.filter((id): id is string => id !== null);
    }

    if (dbTrackIds.length === 0) return null;

    const existingPlaylist = await queryOne(`SELECT id FROM "SystemPlaylist" WHERE "systemId" = $1`, [systemId]);
    
    if (existingPlaylist) {
      await execute(`
        UPDATE "SystemPlaylist" 
        SET "trackIds" = $1, "updatedAt" = NOW()
        WHERE "systemId" = $2
      `, [dbTrackIds, systemId]);
    } else {
      await execute(`
        INSERT INTO "SystemPlaylist" (id, "systemId", name, "trackIds", "updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())
      `, [systemId, name, dbTrackIds]);
    }
  } catch (err) {
    console.error(`[Charts] Error updating ${systemId}:`, err);
  } finally {
    await releaseLock(lockKey);
  }
}

/**
 * Insert the chart entries that weren't already in the catalogue.
 *
 * Two multi-row statements rather than two per track: artists upserted in one
 * pass, then tracks in a second pass now that their artist ids are known.
 * `resolved` is filled in positionally so chart order survives.
 *
 * Both batches are de-duplicated first, and that is not optional. Postgres
 * rejects an `ON CONFLICT DO UPDATE` whose input contains the same conflict key
 * twice — "cannot affect row a second time" — and a Top 50 routinely lists one
 * artist three times, so the un-deduplicated version failed on virtually every
 * real chart. It failed *quietly*, too: the error was caught and logged inside
 * `after()`, so charts simply stopped updating while everything looked healthy.
 */
async function insertResolvedChartTracks(
  chartTracks: ChartTrack[],
  dzResults: Map<number, any>,
  resolved: (string | null)[],
): Promise<void> {
  const entries = [...dzResults.entries()];
  if (entries.length === 0) return;

  // One row per artist name, first occurrence wins.
  const artistImageByName = new Map<string, string | null>();
  for (const [, dz] of entries) {
    const name = dz?.artist?.name;
    if (!name || artistImageByName.has(name)) continue;
    artistImageByName.set(name, dz.artist.picture_medium ?? null);
  }
  if (artistImageByName.size === 0) return;

  const artistRows = await query<{ id: string; name: string }>(
    `INSERT INTO "Artist" (id, name, "imageUrl")
     SELECT gen_random_uuid()::text, n, i
       FROM UNNEST($1::text[], $2::text[]) AS t(n, i)
     ON CONFLICT (name) DO UPDATE
       SET "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl")
     RETURNING id, name`,
    [[...artistImageByName.keys()], [...artistImageByName.values()]],
  );

  const artistIdByName = new Map(artistRows.map((r) => [r.name, r.id]));

  // One row per deezerId. Two chart positions can legitimately point at the
  // same recording; both are recorded here so each position can be filled in
  // from the single inserted row afterwards.
  const positionsByDeezerId = new Map<string, number[]>();
  const rowByDeezerId = new Map<string, { idx: number; dz: any }>();
  for (const [idx, dz] of entries) {
    const dzId = dz?.id?.toString();
    if (!dzId || !artistIdByName.has(dz?.artist?.name)) continue;
    if (!positionsByDeezerId.has(dzId)) {
      positionsByDeezerId.set(dzId, []);
      rowByDeezerId.set(dzId, { idx, dz });
    }
    positionsByDeezerId.get(dzId)!.push(idx);
  }
  if (rowByDeezerId.size === 0) return;

  const unique = [...rowByDeezerId.values()];

  // DO UPDATE rather than DO NOTHING: a chart entry may already exist from a
  // previous refresh or a user download, and only DO UPDATE returns a row for
  // every input, which is what lets each chart position be resolved below.
  const trackRows = await query<{ id: string; deezerId: string }>(
    `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", "coverUrl", "deezerId")
     SELECT gen_random_uuid()::text, ti, ar, du, 'pending', co, dz
       FROM UNNEST($1::text[], $2::text[], $3::int[], $4::text[], $5::text[])
            AS t(ti, ar, du, co, dz)
     ON CONFLICT ("deezerId") DO UPDATE
       SET "coverUrl" = COALESCE("Track"."coverUrl", EXCLUDED."coverUrl")
     RETURNING id, "deezerId"`,
    [
      unique.map(({ idx, dz }) => dz.title ?? chartTracks[idx].title),
      unique.map(({ dz }) => artistIdByName.get(dz.artist.name)!),
      unique.map(({ dz }) => dz.duration || 180),
      unique.map(({ idx, dz }) => dz.album?.cover_big ?? chartTracks[idx].coverUrl ?? null),
      unique.map(({ dz }) => dz.id.toString()),
    ],
  );

  for (const row of trackRows) {
    for (const idx of positionsByDeezerId.get(row.deezerId) ?? []) {
      resolved[idx] = row.id;
    }
  }
}
