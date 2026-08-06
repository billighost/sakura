import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheDel, cacheKey, TTL } from "@/lib/cache";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id!;
  const key = cacheKey("playlist", id);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const playlist = await queryOne(
    `SELECT * FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const tracks = await query(
    `SELECT t.id, t.title, t.duration, t."audioUrl", t."coverUrl", 
       json_build_object('name', a.name) as artist, 
       json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album, 
       pt.position 
     FROM "PlaylistTrack" pt 
     JOIN "Track" t ON pt."trackId" = t.id 
     LEFT JOIN "Artist" a ON t."artistId" = a.id 
     LEFT JOIN "Album" al ON t."albumId" = al.id 
     WHERE pt."playlistId" = $1 
     ORDER BY pt.position ASC`,
    [id]
  );

  const result = { ...playlist, tracks };
  await cacheSet(key, result, TTL.PLAYLIST);
  return NextResponse.json(result);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { name, description } = await req.json();
  const userId = session.user.id!;

  const { rowCount } = await execute(
    `UPDATE "Playlist" SET name = $1, description = $2 WHERE id = $3 AND "userId" = $4`,
    [name, description, id, userId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  await cacheDel(cacheKey("playlist", id), cacheKey("playlists", userId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id!;

  const { rowCount } = await execute(
    `DELETE FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  await cacheDel(cacheKey("playlist", id), cacheKey("playlists", userId));
  return NextResponse.json({ ok: true });
}
