import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { trackId, position } = await req.json();

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const playlist = await queryOne(
    `SELECT id FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, session.user.id!]
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const maxRow = await queryOne<{ maxPos: number | null }>(
    `SELECT MAX(position) as "maxPos" FROM "PlaylistTrack" WHERE "playlistId" = $1`,
    [id]
  );

  const pos = position ?? ((maxRow?.maxPos ?? -1) + 1);

  const { rowCount } = await execute(
    `INSERT INTO "PlaylistTrack" ("playlistId", "trackId", position) VALUES ($1, $2, $3)
     ON CONFLICT ("playlistId", "trackId") DO NOTHING`,
    [id, trackId, pos]
  );
  
  if (rowCount === 0) {
    return NextResponse.json({ error: "Track already in playlist" }, { status: 409 });
  }
  
  return NextResponse.json({ ok: true }, { status: 201 });
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
  const { trackId } = await req.json();

  const { rowCount } = await execute(
    `DELETE FROM "PlaylistTrack" WHERE "playlistId" = $1 AND "trackId" = $2`,
    [id, trackId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Track not in playlist" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
