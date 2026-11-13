import { cache } from "react";
import type { QueryConfig } from "pg";
import { getRebuildPool } from "../data/db";
import { readPublicShare } from "../data/shares";
import { DeezerCatalogService } from "../server/catalog";
import { CachedCatalogProvider, DeezerCatalogProvider, SpotifyCatalogProvider } from "../server/providers";
import { approvedArtworkUrl } from "../player/imagePolicy";
import { cleanPreviewText } from "./metadata";

export type PublicEntityKind = "artist" | "album" | "track" | "playlist" | "mix";
export interface PublicEntityPreview { title: string; artists: string[]; artwork?: string; collage?: string[]; detail?: string; }
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function decodedEntityId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
export function publicEntityReference(value: string): { provider: "deezer" | "spotify"; id: string } | undefined {
  const spotify = /^spotify:([A-Za-z0-9]{22})$/.exec(value);
  if (spotify) return { provider: "spotify", id: spotify[1] };
  const deezer = /^(?:deezer:)?([1-9]\d{0,17})$/.exec(value);
  return deezer ? { provider: "deezer", id: deezer[1] } : undefined;
}
export function validPublicEntityId(kind: PublicEntityKind, value: string) { return UUID_PATTERN.test(value) || (kind !== "mix" && Boolean(publicEntityReference(value))); }
export function publicArtwork(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 3000) return undefined;
  try { return approvedArtworkUrl(value).toString(); } catch { return undefined; }
}

// Public catalogue reads do not initialize recording/audio workers or write account data.
const spotify = process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim() ? new SpotifyCatalogProvider(process.env.SPOTIFY_CLIENT_ID.trim(), process.env.SPOTIFY_CLIENT_SECRET.trim()) : undefined;
const deezer = new CachedCatalogProvider(new DeezerCatalogProvider());
const catalogue = new DeezerCatalogService(fetch, spotify);

async function queryPreview(statement: string, id: string): Promise<Record<string, unknown> | undefined> {
  const query: QueryConfig & { query_timeout: number } = { text: statement, values: [id], query_timeout: 3000 };
  return (await getRebuildPool().query(query)).rows[0];
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(item => cleanPreviewText(item, 90)).filter(Boolean).slice(0, 8) : []; }
function year(value: unknown) { const match = /^(\d{4})/.exec(String(value || "")); return match?.[1]; }

async function readStoredPreview(kind: PublicEntityKind, id: string): Promise<PublicEntityPreview | undefined> {
  let row: Record<string, unknown> | undefined;
  if (kind === "artist") row = await queryPreview('SELECT name AS title, image_url AS artwork FROM sakura_v2."Artist" WHERE id=$1::uuid', id);
  if (kind === "album") row = await queryPreview('SELECT a.title,a.cover_url AS artwork,a.release_date AS "releaseDate",ar.name AS artist FROM sakura_v2."Album" a LEFT JOIN sakura_v2."Artist" ar ON ar.id=a.artist_id WHERE a.id=$1::uuid', id);
  if (kind === "track") row = await queryPreview(`SELECT r.metadata->>'title' AS title,r.metadata->'artists' AS artists,
    COALESCE(r.metadata->>'coverUrl',r.provenance->'catalog'->>'coverUrl') AS artwork,
    COALESCE(r.metadata->>'albumTitle',r.provenance->'catalog'->>'albumTitle') AS "albumTitle"
    FROM sakura_v2."Recording" r WHERE r.id=$1::uuid AND r.state='verified'
    AND EXISTS(SELECT 1 FROM sakura_v2."ExternalReference" e WHERE e.recording_id=r.id AND e.verified_at IS NOT NULL)`, id);
  if (kind === "playlist" || kind === "mix") {
    // The owner requested publicly readable names and artwork for pasted collection links.
    // No account identity, descriptions, listening evidence, or playback locators are selected.
    const playlist = kind === "playlist";
    const table = playlist ? "Playlist" : "Mix";
    const membership = playlist ? "PlaylistRecording" : "MixRecording";
    const foreignKey = playlist ? "playlist_id" : "mix_id";
    row = await queryPreview(`SELECT c.name AS title,${playlist ? 'c.cover_url' : 'NULL::text'} AS artwork,
      (SELECT array_agg(art.url ORDER BY art.position) FROM (
        SELECT COALESCE(r.metadata->>'coverUrl',r.provenance->'catalog'->>'coverUrl') AS url,MIN(m.position) AS position
        FROM sakura_v2."${membership}" m JOIN sakura_v2."Recording" r ON r.id=m.recording_id
        WHERE m.${foreignKey}=c.id AND r.state='verified'
        AND COALESCE(r.metadata->>'coverUrl',r.provenance->'catalog'->>'coverUrl') IS NOT NULL
        GROUP BY COALESCE(r.metadata->>'coverUrl',r.provenance->'catalog'->>'coverUrl') ORDER BY MIN(m.position) LIMIT 4
      ) art) AS collage FROM sakura_v2."${table}" c WHERE c.id=$1::uuid`, id);
  }
  const title = cleanPreviewText(row?.title, 120);
  if (!title) return undefined;
  const collage = Array.isArray(row?.collage) ? row.collage.map(publicArtwork).filter((image): image is string => Boolean(image)).slice(0, 4) : undefined;
  const artists = row?.artists ? strings(row.artists) : row?.artist ? [cleanPreviewText(row.artist, 90)] : [];
  return { title, artists, artwork: publicArtwork(row?.artwork), collage, detail: cleanPreviewText(row?.albumTitle, 110) || year(row?.releaseDate) };
}

const flights = new Map<string, Promise<PublicEntityPreview | undefined>>();
async function loadPublicEntity(kind: PublicEntityKind, rawId: string): Promise<PublicEntityPreview | undefined> {
  const id = decodedEntityId(rawId);
  if (!validPublicEntityId(kind, id)) return undefined;
  const key = kind + ":" + id;
  const pending = flights.get(key);
  if (pending) return pending;
  // Bound social metadata work so a burst of crawlers cannot occupy every DB connection.
  if (flights.size >= 2) return undefined;
  const work = (async () => {
    try {
      if (UUID_PATTERN.test(id)) return await readStoredPreview(kind, id);
      const reference = publicEntityReference(id)!;
      const signal = AbortSignal.timeout(3500);
      if (kind === "track") {
        const track = await (reference.provider === "spotify" ? spotify : deezer)?.getExact(reference, signal);
        if (!track) return undefined;
        return { title: cleanPreviewText(track.metadata.title, 120), artists: strings(track.metadata.artists), artwork: publicArtwork(track.coverUrl), detail: cleanPreviewText(track.albumTitle, 110) };
      }
      if (kind === "mix") return undefined;
      const entity = await catalogue.summary(kind, reference.provider + ":" + reference.id, signal);
      return { title: cleanPreviewText(entity.title, 120), artists: entity.artist ? [cleanPreviewText(entity.artist, 90)] : [], artwork: publicArtwork(entity.imageUrl), collage: entity.coverUrls?.map(publicArtwork).filter((image): image is string => Boolean(image)), detail: year(entity.releaseDate) || entity.genres?.slice(0, 3).join(" · ") };
    } catch { return undefined; }
  })();
  // Also bound pool acquisition time; query_timeout only starts after a connection exists.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 3800); })]);
  flights.set(key, bounded);
  void work.finally(() => { if (timer) clearTimeout(timer); flights.delete(key); });
  return bounded;
}
export const readPublicEntityPreview = cache(loadPublicEntity);
export const readShareForPage = cache(readPublicShare);
