import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const track = await queryOne(
      `SELECT
        t.id, t.title, t.duration, t."trackNumber", t.genre, t."audioUrl", t."coverUrl",
        json_build_object('name', a.name) AS artist,
        json_build_object('title', al.title, 'coverUrl', al."coverUrl") AS album
      FROM "Track" t
      LEFT JOIN "Artist" a ON t."artistId" = a.id
      LEFT JOIN "Album" al ON t."albumId" = al.id
      WHERE t.id = $1`,
      [id],
    );

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json(track);
  } catch (err) {
    console.error("Failed to fetch track:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
