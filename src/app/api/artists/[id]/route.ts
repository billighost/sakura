import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
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
    const artist = await queryOne(
      `SELECT
        a.*,
        (SELECT COUNT(DISTINCT t.id) FROM "Track" t WHERE t."artistId" = a.id) +
        (SELECT COUNT(DISTINCT ta."trackId") FROM "TrackArtist" ta WHERE ta."artistId" = a.id) AS "trackCount",
        COUNT(DISTINCT al.id)::int AS "albumCount"
      FROM "Artist" a
      LEFT JOIN "Album" al ON al."artistId" = a.id
      WHERE a.id = $1
      GROUP BY a.id`,
      [id],
    );

    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    const [albums, tracks] = await Promise.all([
      query(
        `SELECT
          al.*,
          COUNT(t.id)::int AS "trackCount"
        FROM "Album" al
        LEFT JOIN "Track" t ON t."albumId" = al.id
        WHERE al."artistId" = $1
        GROUP BY al.id
        ORDER BY al.title ASC`,
        [id],
      ),
      query(
        `SELECT
          t.id, t.title, t.duration, t."trackNumber", t.genre, t."audioUrl", t."coverUrl",
          json_build_object('name', a.name, 'id', a.id) AS artist,
          json_build_object('title', al.title, 'coverUrl', al."coverUrl", 'id', al.id) AS album,
          COALESCE(
            (SELECT json_agg(json_build_object('name', a2.name, 'id', a2.id, 'role', ta.role))
             FROM "TrackArtist" ta
             JOIN "Artist" a2 ON ta."artistId" = a2.id
             WHERE ta."trackId" = t.id),
            '[]'::json
          ) AS "otherArtists"
        FROM "Track" t
        LEFT JOIN "Artist" a ON t."artistId" = a.id
        LEFT JOIN "Album" al ON t."albumId" = al.id
        WHERE t."artistId" = $1
           OR EXISTS (SELECT 1 FROM "TrackArtist" ta WHERE ta."trackId" = t.id AND ta."artistId" = $1)
        ORDER BY t."createdAt" DESC`,
        [id],
      ),
    ]);

    return NextResponse.json({ ...artist, albums, tracks });
  } catch (err) {
    console.error("Failed to fetch artist:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
