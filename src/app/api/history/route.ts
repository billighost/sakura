import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));
  const userId = session.user.id!;
  
  const key = cacheKey("history", userId, limit);
  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const tracks = await query(
    `SELECT DISTINCT ON (h."trackId") h."trackId", 
       t.id, t.title, t.duration, t."audioUrl", t."coverUrl",
       json_build_object('name', a.name) as artist, 
       json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album 
     FROM "ListeningHistory" h 
     JOIN "Track" t ON h."trackId" = t.id 
     LEFT JOIN "Artist" a ON t."artistId" = a.id 
     LEFT JOIN "Album" al ON t."albumId" = al.id 
     WHERE h."userId" = $1 
     ORDER BY h."trackId", h."playedAt" DESC 
     LIMIT $2`,
    [userId, limit]
  );

  await cacheSet(key, tracks, TTL.HISTORY);
  return NextResponse.json(tracks);
}
