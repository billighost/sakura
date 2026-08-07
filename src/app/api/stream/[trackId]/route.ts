import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";

/**
 * Resolve a track to its playable URL.
 *
 * This deliberately does *not* write listening history. It used to insert a
 * ListeningHistory row per request, which made every stream open look like a
 * completed play — the audio element hits this endpoint on load, on seek, and
 * on range requests, so a single song could log a dozen "plays" while a song
 * someone skipped instantly logged exactly as strong a signal as one they
 * loved. Real play data now comes from the client via /api/signals, which
 * knows how long the audio was actually audible.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;

  const track = await queryOne<{ audioUrl: string }>(
    `SELECT "audioUrl" FROM "Track" WHERE id = $1`,
    [trackId]
  );

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  if (!track.audioUrl || track.audioUrl === "pending") {
    return NextResponse.json({ error: "Track has no audio yet" }, { status: 409 });
  }

  return NextResponse.redirect(track.audioUrl);
}
