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
  const userId = session.user.id!;
  // Scope the cache key to the user. A mix id is already user-owned, but a
  // shared key is the kind of thing that silently becomes a data leak the
  // moment someone adds a lookup by another route.
  const key = cacheKey("mix", userId, id);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  const mix = await queryOne(
    `SELECT * FROM "UserMix" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (!mix) {
    return NextResponse.json({ error: "Mix not found" }, { status: 404 });
  }

  // Fetch all tracks in the mix in order
  const tracks = [];
  if (mix.trackIds && mix.trackIds.length > 0) {
    const trackRows = await query(
      `SELECT t.id, t.title, t.duration, t."audioUrl",
         COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl",
         json_build_object('name', COALESCE(a.name, 'Unknown Artist'), 'id', a.id) as artist,
         -- Without the NULL guard this yields {"title": null} for a track with
         -- no album, which reads as a real album downstream and renders an
         -- empty link.
         CASE WHEN al.id IS NULL THEN NULL
              ELSE json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id)
         END as album
       FROM "Track" t
       LEFT JOIN "Artist" a ON t."artistId" = a.id
       LEFT JOIN "Album" al ON t."albumId" = al.id
       WHERE t.id = ANY($1::text[])`,
      [mix.trackIds]
    );

    // Reorder tracks to match mix.trackIds
    const trackMap = new Map(trackRows.map(t => [t.id, t]));
    for (const tid of mix.trackIds) {
      if (trackMap.has(tid)) {
        tracks.push(trackMap.get(tid));
      }
    }
  }

  const result = {
    id: mix.id,
    name: mix.label,
    subtitle: mix.subtitle,
    description: mix.description,
    coverUrl: mix.coverUrl,
    coverUrls: mix.coverUrls ?? [],
    kind: mix.kind,
    tracks
  };
  
  await cacheSet(key, result, TTL.PLAYLIST);
  return NextResponse.json(result);
}
