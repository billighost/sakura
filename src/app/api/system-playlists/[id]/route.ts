import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheKey, cached, TTL } from "@/lib/cache";
import { getChartTrackMeta, mergeChartTracks } from "@/lib/chartTracks";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = cacheKey("system-playlist", id);

  const result = await cached(key, TTL.PLAYLIST, async () => {
    const playlist = await queryOne(
      `SELECT * FROM "SystemPlaylist" WHERE "systemId" = $1`,
      [id]
    );
    if (!playlist) return null;

    const trackIds: string[] = playlist.trackIds ?? [];
    if (trackIds.length === 0) {
      return {
        id: playlist.systemId,
        name: playlist.name,
        description: playlist.description,
        coverUrl: playlist.coverUrl,
        tracks: [],
      };
    }

    /**
     * Every id is looked up, and virtuality is decided by what comes back —
     * not by the shape of the id.
     *
     * Filtering on a `deezer-` prefix first looks like a cheap way to skip
     * pointless lookups, and it is wrong: the download path creates real Track
     * rows whose ids are literally `deezer-<id>`, so the prefix does not
     * distinguish "not in the database" from "in the database with that name".
     * On the community chart — built from listening history, which is full of
     * such rows — that silently dropped 23 of 31 entries. A row that resolves is
     * real; one that doesn't falls back to the cached chart metadata.
     */
    const [trackRows, meta] = await Promise.all([
      query(
        `SELECT t.id, t.title, t.duration, t."audioUrl", t."coverUrl",
           json_build_object('name', a.name) as artist,
           json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album
         FROM "Track" t
         LEFT JOIN "Artist" a ON t."artistId" = a.id
         LEFT JOIN "Album" al ON t."albumId" = al.id
         WHERE t.id = ANY($1::text[])`,
        [trackIds]
      ),
      getChartTrackMeta(id),
    ]);

    return {
      id: playlist.systemId,
      name: playlist.name,
      description: playlist.description,
      coverUrl: playlist.coverUrl,
      tracks: mergeChartTracks(trackIds, new Map(trackRows.map((t) => [t.id, t])), meta),
    };
  });

  if (!result) {
    return NextResponse.json({ error: "System Playlist not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
