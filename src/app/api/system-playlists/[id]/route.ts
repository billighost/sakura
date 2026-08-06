import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";

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

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const playlist = await queryOne(
    `SELECT * FROM "SystemPlaylist" WHERE "systemId" = $1`,
    [id]
  );

  if (!playlist) {
    return NextResponse.json({ error: "System Playlist not found" }, { status: 404 });
  }

  // Fetch all tracks in order
  const tracks = [];
  if (playlist.trackIds && playlist.trackIds.length > 0) {
    const trackRows = await query(
      `SELECT t.id, t.title, t.duration, t."audioUrl", t."coverUrl", 
         json_build_object('name', a.name) as artist, 
         json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album
       FROM "Track" t 
       LEFT JOIN "Artist" a ON t."artistId" = a.id 
       LEFT JOIN "Album" al ON t."albumId" = al.id 
       WHERE t.id = ANY($1::text[])`,
      [playlist.trackIds]
    );

    // Reorder tracks to match trackIds
    const trackMap = new Map(trackRows.map(t => [t.id, t]));
    for (const tid of playlist.trackIds) {
      if (trackMap.has(tid)) {
        tracks.push(trackMap.get(tid));
      }
    }
  }

  const result = { 
    id: playlist.systemId, 
    name: playlist.name, 
    description: playlist.description, 
    coverUrl: playlist.coverUrl, 
    tracks 
  };
  
  await cacheSet(key, result, TTL.PLAYLIST);
  return NextResponse.json(result);
}
