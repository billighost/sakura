import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const tracks = await query(
    `SELECT DISTINCT ON (h."trackId") h."trackId", t.*, json_build_object('name', a.name) as artist, json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album FROM "ListeningHistory" h JOIN "Track" t ON h."trackId" = t.id LEFT JOIN "Artist" a ON t."artistId" = a.id LEFT JOIN "Album" al ON t."albumId" = al.id WHERE h."userId" = $1 ORDER BY h."trackId", h."playedAt" DESC LIMIT $2`,
    [session.user.id!, limit]
  );

  return NextResponse.json(tracks);
}
