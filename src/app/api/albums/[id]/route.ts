import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheKey, TTL } from "@/lib/cache";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const key = cacheKey("album", id);

  try {
    const cached = await cacheGet(key);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }

    const album = await queryOne(
      `SELECT
        al.*,
        json_build_object('name', a.name, 'id', a.id) AS artist
      FROM "Album" al
      LEFT JOIN "Artist" a ON al."artistId" = a.id
      WHERE al.id = $1`,
      [id],
    );

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const tracks = await query(
      `SELECT
        t.id, t.title, t.duration, t."trackNumber", t."audioUrl", t."coverUrl",
        json_build_object('name', ar.name) AS artist
      FROM "Track" t
      LEFT JOIN "Artist" ar ON t."artistId" = ar.id
      WHERE t."albumId" = $1
      ORDER BY t."trackNumber" ASC`,
      [id],
    );

    const result = { ...album, tracks };
    await cacheSet(key, result, TTL.ALBUM);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to fetch album:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
