import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, softFail } from "@/lib/sql";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import { cachedWithStale, versionedKey, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

/**
 * Everything-search: artists and playlists.
 *
 * Tracks stay on /api/music/search — that route owns provider fan-out, circuit
 * breaking and the stale-cache fallback, and none of that belongs here.
 *
 * Both sections merge two sources:
 *
 *   LOCAL   — artists we hold tracks for, and public playlists our users have
 *             published. Authoritative, instantly playable, and the only
 *             source that can answer "you have 40 songs by this artist".
 *
 *   DEEZER  — the same catalogue the rest of the app searches. Keyless and
 *             unauthenticated for public data (`/search/artist`,
 *             `/search/playlist`). This is what makes search useful on a fresh
 *             install, where the local catalogue is empty and a local-only
 *             query returns nothing at all.
 *
 * Local always ranks above external, and an external row that duplicates a
 * local one is dropped — otherwise an artist you own appears twice, once
 * playable and once not.
 *
 * Privacy note: only `isPublic` playlists are ever read from our own database.
 * Deezer playlists are public by construction; their private ones require
 * OAuth we don't hold and can't reach.
 *
 * The `%` operator needs pg_trgm. If the extension or index is missing the
 * query throws rather than returning nothing, so the local halves use
 * softFail: a degraded section is logged and the rest of the page still
 * renders. (A bare `.catch(() => [])` is what previously hid a broken trigram
 * index for months — it looked identical to "no matches".)
 */

export interface ArtistHit {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  source: "library" | "deezer";
  deezerId?: number;
}

export interface PlaylistHit {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  source: "library" | "deezer";
  externalUrl?: string;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "6")));

  if (!q) {
    return NextResponse.json({ artists: [], playlists: [] });
  }

  const rl = await rateLimit(
    `search-all:${session.user.id}`,
    LIMITS.search.limit,
    LIMITS.search.window
  );
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    /*
     * Versioned namespace, so publishing or unpublishing a playlist can
     * invalidate every cached search result in a single command rather than
     * scanning the keyspace for matching prefixes.
     */
    const result = await cachedWithStale(
      await versionedKey("search:entities", q.toLowerCase(), limit),
      TTL.search,
      async () => {
        const [localArtists, localPlaylists, dzArtists, dzPlaylists] =
          await Promise.all([
            searchLocalArtists(q, limit),
            searchLocalPlaylists(q, limit),
            searchDeezerArtists(q, limit),
            searchDeezerPlaylists(q, limit),
          ]);

        return {
          artists: mergeArtists(localArtists, dzArtists, limit),
          playlists: mergePlaylists(localPlaylists, dzPlaylists, limit),
        };
      },
      { label: "search-entities" }
    );

    return NextResponse.json(result ?? { artists: [], playlists: [] }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error("[SearchEntities]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

/* ── Merge ────────────────────────────────────────────────────────────────
 *
 * Name-based dedupe. We can't join on deezerId alone: an artist imported
 * before we started recording it has none, and would then appear twice.
 */

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function mergeArtists(local: ArtistHit[], external: ArtistHit[], limit: number) {
  const seen = new Set(local.map((a) => norm(a.name)));
  const out = [...local];
  for (const a of external) {
    if (out.length >= limit) break;
    if (seen.has(norm(a.name))) continue;
    seen.add(norm(a.name));
    out.push(a);
  }
  return out.slice(0, limit);
}

function mergePlaylists(local: PlaylistHit[], external: PlaylistHit[], limit: number) {
  const seen = new Set(local.map((p) => norm(p.name)));
  const out = [...local];
  for (const p of external) {
    if (out.length >= limit) break;
    if (seen.has(norm(p.name))) continue;
    seen.add(norm(p.name));
    out.push(p);
  }
  return out.slice(0, limit);
}

/* ── Local ────────────────────────────────────────────────────────────────── */

async function searchLocalArtists(q: string, limit: number): Promise<ArtistHit[]> {
  const rows = await query<{
    id: string;
    name: string;
    imageUrl: string | null;
    trackCount: number;
  }>(
    `SELECT a.id, a.name, a."imageUrl",
            COUNT(t.id)::int AS "trackCount"
       FROM "Artist" a
       LEFT JOIN "Track" t ON t."artistId" = a.id AND t."audioUrl" IS NOT NULL
      WHERE a.name % $1 OR a.name ILIKE $2
      GROUP BY a.id, a.name, a."imageUrl"
      -- An artist with nothing playable is a dead end; leave those to Deezer,
      -- which at least offers a preview and a download path.
      HAVING COUNT(t.id) > 0
      ORDER BY
        (lower(a.name) = lower($1)) DESC,
        similarity(a.name, $1) DESC,
        COUNT(t.id) DESC
      LIMIT $3`,
    [q, `%${q}%`, limit]
  ).catch(softFail<any[]>("search:artists", []));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageUrl: r.imageUrl,
    trackCount: r.trackCount,
    source: "library" as const,
  }));
}

async function searchLocalPlaylists(q: string, limit: number): Promise<PlaylistHit[]> {
  const rows = await query<{
    id: string;
    name: string;
    description: string | null;
    coverUrl: string | null;
    trackCount: number;
    ownerName: string | null;
  }>(
    `SELECT p.id, p.name, p.description, p."coverUrl",
            COUNT(pt."trackId")::int AS "trackCount",
            u.username AS "ownerName"
       FROM "Playlist" p
       JOIN "User" u ON u.id = p."userId"
       LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
      WHERE p."isPublic" = TRUE
        AND (p.name % $1 OR p.name ILIKE $2)
      GROUP BY p.id, p.name, p.description, p."coverUrl", u.username
      HAVING COUNT(pt."trackId") > 0
      ORDER BY
        (lower(p.name) = lower($1)) DESC,
        similarity(p.name, $1) DESC,
        COUNT(pt."trackId") DESC
      LIMIT $3`,
    [q, `%${q}%`, limit]
  ).catch(softFail<any[]>("search:playlists", []));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    coverUrl: r.coverUrl,
    trackCount: r.trackCount,
    ownerName: r.ownerName,
    source: "library" as const,
  }));
}

/* ── Deezer ───────────────────────────────────────────────────────────────
 *
 * Public catalogue endpoints, no key and no OAuth. Called server-side, which
 * also sidesteps Deezer's lack of CORS headers.
 *
 * Both go through `callProvider`, so they share the circuit breaker with the
 * rest of the app's Deezer traffic: if Deezer is down, these fail fast and the
 * local half of the page still renders instead of every search hanging.
 */

async function searchDeezerArtists(q: string, limit: number): Promise<ArtistHit[]> {
  const data = await callProvider<any>(
    async (signal) => {
      const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return res.json();
    },
    { provider: "deezer", op: "search-artist", timeoutMs: 5000, attempts: 2 }
  );

  const items = (data?.data ?? []) as {
    id: number;
    name: string;
    picture_medium?: string;
    picture_big?: string;
    nb_album?: number;
  }[];

  if (!items.length) return [];

  /*
   * Resolve which of these we already have, so a Deezer row for an artist we
   * hold links to the local page (with real, playable tracks) rather than to a
   * second, emptier copy. One query, not one per artist.
   */
  const names = items.map((a) => a.name.toLowerCase());
  const owned = await query<{ id: string; name: string; deezerId: string | null }>(
    `SELECT id, name, "deezerId" FROM "Artist"
      WHERE lower(name) = ANY($1::text[]) OR "deezerId" = ANY($2::text[])`,
    [names, items.map((a) => String(a.id))]
  ).catch(softFail<any[]>("search:artists-owned", []));

  const localByName = new Map(owned.map((o) => [o.name.toLowerCase(), o]));
  const localByDeezerId = new Map(
    owned.filter((o) => o.deezerId).map((o) => [o.deezerId as string, o])
  );

  return items.map((a) => {
    const local =
      localByDeezerId.get(String(a.id)) ?? localByName.get(a.name.toLowerCase());
    return {
      // A known artist keeps its local id so the link resolves to a real page.
      id: local ? local.id : `deezer-${a.id}`,
      name: a.name,
      imageUrl: a.picture_big || a.picture_medium || null,
      trackCount: 0,
      source: local ? ("library" as const) : ("deezer" as const),
      deezerId: a.id,
    };
  });
}

async function searchDeezerPlaylists(q: string, limit: number): Promise<PlaylistHit[]> {
  const data = await callProvider<any>(
    async (signal) => {
      const url = `https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&limit=${limit}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return res.json();
    },
    { provider: "deezer", op: "search-playlist", timeoutMs: 5000, attempts: 2 }
  );

  const items = (data?.data ?? []) as {
    id: number;
    title: string;
    description?: string;
    picture_medium?: string;
    picture_big?: string;
    nb_tracks?: number;
    link?: string;
    user?: { name?: string };
  }[];

  return items
    // Deezer returns untitled and empty playlists; neither is worth a row.
    .filter((p) => p.title?.trim() && (p.nb_tracks ?? 0) > 0)
    .map((p) => ({
      id: `deezer-${p.id}`,
      name: p.title,
      description: p.description?.trim() || null,
      coverUrl: p.picture_big || p.picture_medium || null,
      trackCount: p.nb_tracks ?? 0,
      ownerName: p.user?.name ?? null,
      source: "deezer" as const,
      externalUrl: p.link,
    }));
}
