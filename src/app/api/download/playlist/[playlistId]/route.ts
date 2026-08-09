import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cached, cacheKey } from "@/lib/cache";

interface PlaylistTrackRow {
  id: string;
  title: string;
  audioUrl: string;
  coverUrl: string | null;
  artistName: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ playlistId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { playlistId } = await params;

  try {
    // BUG-5 FIX: Separate "not found" (404) from "access denied" (403)
    // so callers can distinguish a missing playlist from a permission error.
    const playlist = await queryOne<{ userId: string }>(
      `SELECT "userId" FROM "Playlist" WHERE id = $1`,
      [playlistId],
    );

    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    if (playlist.userId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const tracks = await cached<PlaylistTrackRow[]>(
      cacheKey("dl:playlist", playlistId),
      60,
      () => query<PlaylistTrackRow>(
        `SELECT t.id, t.title, t."audioUrl", t."coverUrl", a.name AS "artistName"
         FROM "PlaylistTrack" pt
         JOIN "Track" t ON pt."trackId" = t.id
         JOIN "Artist" a ON t."artistId" = a.id
         WHERE pt."playlistId" = $1
         ORDER BY pt.position ASC`,
        [playlistId],
      )
    );

    return NextResponse.json(
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        audioUrl: t.audioUrl,
        coverUrl: t.coverUrl,
        artistName: t.artistName,
      })),
    );
  } catch (err) {
    console.error("Failed to fetch playlist for download:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
