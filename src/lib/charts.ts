import { query, queryOne, execute } from './sql';
import { searchDeezerTrack } from './metadata';
import { cacheGet, cacheSet } from './cache';

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
  const lockKey = `lock:charts-update:${systemId}`;
  const isLocked = await cacheGet(lockKey);
  if (isLocked) {
    console.log(`[Charts] Update for ${systemId} is locked. Skipping.`);
    return;
  }
  // Lock for 5 minutes
  await cacheSet(lockKey, '1', 300);

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

      for (const ct of chartTracks) {
        const existing = await queryOne(`
          SELECT t.id 
          FROM "Track" t
          JOIN "Artist" a ON t."artistId" = a.id
          WHERE t.title ILIKE $1 AND a.name ILIKE $2
          LIMIT 1
        `, [ct.title, ct.artist]);

        if (existing) {
          dbTrackIds.push(existing.id);
        } else {
          const dzTrack = await searchDeezerTrack(ct.title, ct.artist);
          if (dzTrack) {
            // ON CONFLICT rather than a bare INSERT: `Artist.name` is unique,
            // and two chart updates running concurrently (global + country,
            // say) will genuinely race on the same artist. Without this the
            // insert throws and aborts the whole chart refresh.
            const artistRow = await queryOne<{ id: string }>(`
              INSERT INTO "Artist" (id, name, "imageUrl")
              VALUES (gen_random_uuid()::text, $1, $2)
              ON CONFLICT (name) DO UPDATE SET "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl")
              RETURNING id
            `, [dzTrack.artist.name, dzTrack.artist.picture_medium]);

            if (!artistRow) continue;

            const trackRow = await queryOne<{ id: string }>(`
              INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", "coverUrl", "deezerId")
              VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
              RETURNING id
            `, [
              dzTrack.title,
              artistRow.id,
              dzTrack.duration || 180,
              dzTrack.preview || "pending",
              dzTrack.album?.cover_big || ct.coverUrl,
              dzTrack.id.toString()
            ]);

            if (trackRow) dbTrackIds.push(trackRow.id);
          }
        }
      }
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
        INSERT INTO "SystemPlaylist" ("systemId", name, "trackIds", "updatedAt")
        VALUES ($1, $2, $3, NOW())
      `, [systemId, name, dbTrackIds]);
    }
  } catch (err) {
    console.error(`[Charts] Error updating ${systemId}:`, err);
  }
}
