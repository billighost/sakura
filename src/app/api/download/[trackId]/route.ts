import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cached, cacheKey } from "@/lib/cache";

interface TrackRow {
  id: string;
  title: string;
  audioUrl: string;
  coverUrl: string | null;
  artistName: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;

  try {
    // Track metadata (title, artist, audioUrl, coverUrl) is effectively
    // immutable after a Telegram download sets it. Cache for 5 minutes so
    // repeated requests from the download queue worker hit L1 instead of DB.
    const key = cacheKey("dl:meta", trackId);
    const track = await cached<TrackRow | null>(key, 5 * 60, async () => {
      return await queryOne<TrackRow>(
        `SELECT t.id, t.title, t."audioUrl", t."coverUrl", a.name AS "artistName"
         FROM "Track" t
         JOIN "Artist" a ON t."artistId" = a.id
         WHERE t.id = $1`,
        [trackId],
      ) ?? null;
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: track.id,
      title: track.title,
      audioUrl: track.audioUrl,
      coverUrl: track.coverUrl,
      artistName: track.artistName,
    });
  } catch (err) {
    console.error("Failed to fetch track for download:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
