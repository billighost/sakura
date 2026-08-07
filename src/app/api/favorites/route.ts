import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheDel, cacheKey, TTL } from "@/lib/cache";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const key = cacheKey("favorites", userId);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const tracks = await query(
    `SELECT
       t.id, t.title, t.duration, t."audioUrl", t."coverUrl",
       f."createdAt" AS "likedAt",
       json_build_object('name', a.name, 'id', a.id) AS artist,
       json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id) AS album
     FROM "Favorite" f
     JOIN "Track" t ON f."trackId" = t.id
     LEFT JOIN "Artist" a ON t."artistId" = a.id
     LEFT JOIN "Album" al ON t."albumId" = al.id
     WHERE f."userId" = $1
     ORDER BY f."createdAt" DESC`,
    [userId]
  );

  await cacheSet(key, tracks, TTL.FAVORITES);
  return NextResponse.json(tracks);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await req.json();
  const userId = session.user.id!;

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  await execute(
    `INSERT INTO "Favorite" ("userId", "trackId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, trackId]
  );

  await cacheDel(cacheKey("favorites", userId), cacheKey("home", userId));
  return NextResponse.json({ liked: true });
}
