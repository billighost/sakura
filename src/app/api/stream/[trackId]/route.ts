import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

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

  execute(
    `INSERT INTO "ListeningHistory" ("userId", "trackId") VALUES ($1, $2)`,
    [session.user.id!, trackId]
  ).catch(() => {});

  return NextResponse.redirect(track.audioUrl);
}
