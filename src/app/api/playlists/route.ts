import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const playlists = await query(
    `SELECT p.*, COUNT(pt."trackId")::int as "trackCount" FROM "Playlist" p LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id WHERE p."userId" = $1 GROUP BY p.id ORDER BY p."createdAt" DESC`,
    [userId]
  );

  return NextResponse.json(playlists);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, description } = await req.json();
  const userId = session.user.id!;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const playlist = await queryOne(
    `INSERT INTO "Playlist" (id, "userId", name, description) VALUES (gen_random_uuid()::text, $1, $2, $3) RETURNING *`,
    [userId, name, description || null]
  );

  return NextResponse.json(playlist, { status: 201 });
}
