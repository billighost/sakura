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

  if (!trackId || typeof trackId !== "string" || trackId.trim().length === 0) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  let trackExists = await query<{ id: string }>(
    `SELECT id FROM "Track" WHERE id = $1`,
    [trackId]
  ).then(r => r[0] || null).catch(() => null);

  if (!trackExists && trackId.startsWith("deezer-")) {
    const dzId = trackId.replace("deezer-", "");
    try {
      const res = await fetch(`https://api.deezer.com/track/${dzId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && data.artist) {
          const artistRows = await query<{ id: string }>(
            `INSERT INTO "Artist" (id, name, "imageUrl", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, NOW())
             ON CONFLICT (name) DO UPDATE SET "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl")
             RETURNING id`,
            [data.artist.name, data.artist.picture_medium || null]
          ).catch(() => []);
          const artistId = artistRows[0]?.id;
          if (artistId) {
            await execute(
              `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", "coverUrl", "deezerId", "previewUrl", "createdAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
               ON CONFLICT (id) DO NOTHING`,
              [
                trackId,
                data.title,
                artistId,
                data.duration || 0,
                data.preview || null,
                data.album?.cover_big || data.album?.cover_medium || null,
                dzId,
                data.preview || null,
              ]
            ).catch(() => {});
            trackExists = { id: trackId };
          }
        }
      }
    } catch {
      // non-critical
    }
  }

  if (!trackExists) {
    return NextResponse.json({ error: "Track not found in database" }, { status: 404 });
  }

  await execute(
    `INSERT INTO "Favorite" ("userId", "trackId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, trackId]
  );

  await cacheDel(cacheKey("favorites", userId), cacheKey("home", userId));
  return NextResponse.json({ liked: true });
}
