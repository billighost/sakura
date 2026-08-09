import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, softFail } from "@/lib/sql";
import { cachedWithStale, cacheKey, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

/**
 * Read an artist or playlist that lives on Deezer rather than in our database.
 *
 * Search can now surface catalogue entries we don't hold — that's the point,
 * it's what makes a fresh install useful. But a result you can't open is worse
 * than no result, so those rows need somewhere to land. This is that endpoint:
 * given a Deezer id, return the tracklist in exactly the shape TrackRow and
 * the player already consume.
 *
 * Every track comes back resolved against our own catalogue first, so anything
 * we already hold plays immediately from our storage instead of being offered
 * as a 30-second preview.
 *
 * Deezer's public catalogue endpoints need no key and no OAuth. Called
 * server-side, which also sidesteps their missing CORS headers.
 */

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

interface ResolvedTrack {
  id: string;
  title: string;
  artist: string;
  artistId: number;
  album: string;
  albumId: number;
  coverUrl: string;
  duration: number;
  preview: string;
  source: "library" | "deezer";
  audioUrl: string | null;
  isDownloaded: boolean;
  deezerTrackId: number;
}

/**
 * One payload shape for both kinds. Artist-only and playlist-only fields are
 * optional rather than split across a union — the caller renders a single
 * component and a union here just forces a cast at every read site.
 */
interface ExternalPayload {
  kind: "artist" | "playlist";
  id: string;
  name: string;
  tracks: ResolvedTrack[];
  description?: string | null;
  coverUrl?: string | null;
  imageUrl?: string | null;
  ownerName?: string | null;
  followers?: number | null;
  albumCount?: number | null;
  unavailable?: boolean;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { kind, id } = await params;

  if (kind !== "artist" && kind !== "playlist") {
    return NextResponse.json({ error: "Unknown kind" }, { status: 404 });
  }

  // Deezer ids are numeric. Rejecting anything else keeps this from being
  // turned into a general-purpose request proxy.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const result = await cachedWithStale(
      cacheKey("external", kind, id),
      TTL.search,
      () => (kind === "artist" ? loadArtist(id) : loadPlaylist(id)),
      { label: `external-${kind}` }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Couldn't reach the music catalogue. Try again in a moment." },
        { status: 503 }
      );
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("[External]", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

async function loadArtist(id: string): Promise<ExternalPayload | null> {
  const [artist, top] = await Promise.all([
    dz(`https://api.deezer.com/artist/${id}`, "artist"),
    dz(`https://api.deezer.com/artist/${id}/top?limit=50`, "artist-top"),
  ]);

  if (!artist || artist.error) return null;

  return {
    kind: "artist",
    id: `deezer-${id}`,
    name: artist.name,
    imageUrl: artist.picture_big || artist.picture_medium || null,
    followers: artist.nb_fan ?? null,
    albumCount: artist.nb_album ?? null,
    tracks: await resolveTracks((top?.data ?? []) as DeezerTrack[]),
  };
}

async function loadPlaylist(id: string): Promise<ExternalPayload | null> {
  const playlist = await dz(`https://api.deezer.com/playlist/${id}`, "playlist");
  if (!playlist) return null;

  /*
   * A private playlist answers with an OAuthException in the body rather than
   * a 4xx, so the HTTP layer sees success. Detect it explicitly — otherwise
   * the page renders an empty playlist with no explanation.
   */
  if (playlist.error) {
    return {
      kind: "playlist",
      id: `deezer-${id}`,
      name: "Unavailable",
      description: "This playlist is private on Deezer, so it can't be opened here.",
      coverUrl: null,
      ownerName: null,
      tracks: [],
      unavailable: true,
    };
  }

  return {
    kind: "playlist",
    id: `deezer-${id}`,
    name: playlist.title,
    description: playlist.description?.trim() || null,
    coverUrl: playlist.picture_big || playlist.picture_medium || null,
    ownerName: playlist.creator?.name ?? null,
    tracks: await resolveTracks((playlist.tracks?.data ?? []) as DeezerTrack[]),
  };
}

function dz(url: string, op: string) {
  return callProvider<any>(
    async (signal) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return res.json();
    },
    { provider: "deezer", op, timeoutMs: 6000, attempts: 2 }
  );
}

/**
 * Map Deezer tracks into our track shape, marking the ones we already hold so
 * they play from our own storage rather than as a preview clip.
 */
async function resolveTracks(items: DeezerTrack[]): Promise<ResolvedTrack[]> {
  if (!items.length) return [];

  const owned = await query<{ id: string; deezerId: string; audioUrl: string }>(
    `SELECT id, "deezerId", "audioUrl" FROM "Track"
      WHERE "deezerId" = ANY($1::text[]) AND "audioUrl" IS NOT NULL`,
    [items.map((t) => String(t.id))]
  ).catch(softFail<any[]>("external:owned", []));

  const byDeezerId = new Map(owned.map((o) => [o.deezerId, o]));

  return items.map((t) => {
    const local = byDeezerId.get(String(t.id));
    return {
      id: local ? local.id : `deezer-${t.id}`,
      title: t.title,
      artist: t.artist.name,
      artistId: t.artist.id,
      album: t.album.title,
      albumId: t.album.id,
      coverUrl: t.album.cover_big || t.album.cover_medium || "",
      duration: t.duration,
      preview: t.preview,
      source: local ? ("library" as const) : ("deezer" as const),
      audioUrl: local?.audioUrl ?? null,
      isDownloaded: !!local,
      deezerTrackId: t.id,
    };
  });
}
