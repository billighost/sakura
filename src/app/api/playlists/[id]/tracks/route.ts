import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheDel, cacheKey } from "@/lib/cache";

/**
 * Ownership check, shared by every mutating handler here.
 *
 * DELETE used to skip it entirely — it deleted by `playlistId` and `trackId`
 * with no reference to the session at all, so any signed-in user could remove
 * tracks from anyone else's playlist given its id. POST checked; DELETE didn't.
 */
async function assertOwner(playlistId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT id FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [playlistId, userId]
  );
  return Boolean(row);
}

/**
 * Drop the cached playlist so the next read reflects the change.
 *
 * GET caches the playlist and its tracks together under one key for TTL.PLAYLIST.
 * None of the mutations here invalidated it, so removing a track appeared to
 * work and then the song came back on the next visit — the classic "my change
 * didn't save" report where the write succeeded and the read was stale.
 */
async function invalidate(playlistId: string, userId: string) {
  await cacheDel(cacheKey("playlist", playlistId), cacheKey("playlists", userId));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { trackId, position } = await req.json();
  const userId = session.user.id!;

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  if (!(await assertOwner(id, userId))) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const maxRow = await queryOne<{ maxPos: number | null }>(
    `SELECT MAX(position) as "maxPos" FROM "PlaylistTrack" WHERE "playlistId" = $1`,
    [id]
  );

  const pos = position ?? ((maxRow?.maxPos ?? -1) + 1);

  const { rowCount } = await execute(
    `INSERT INTO "PlaylistTrack" ("playlistId", "trackId", position) VALUES ($1, $2, $3)
     ON CONFLICT ("playlistId", "trackId") DO NOTHING`,
    [id, trackId, pos]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Track already in playlist" }, { status: 409 });
  }

  await invalidate(id, userId);
  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * Reorder. Takes the complete list of track ids in their new order.
 *
 * The whole list rather than a from/to pair, because the client already knows the
 * order it is showing and sending it wholesale is the only version that can't
 * drift: a from/to pair applied to a server-side list that has since changed
 * puts the track somewhere neither side intended.
 *
 * Positions are rewritten in a single statement built from a VALUES list. The
 * obvious alternative — one UPDATE per track — is N round trips to a database
 * whose RTT dominates everything (see the perf notes), so a 60-track playlist
 * would take seconds.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id!;
  const body = await req.json().catch(() => null);
  const trackIds: unknown = body?.trackIds;

  if (!Array.isArray(trackIds) || trackIds.some((t) => typeof t !== "string")) {
    return NextResponse.json({ error: "trackIds must be an array of ids" }, { status: 400 });
  }
  // A playlist long enough to hit this is a sign of a client bug, not a user.
  if (trackIds.length > 2000) {
    return NextResponse.json({ error: "Too many tracks" }, { status: 400 });
  }
  if (trackIds.length === 0) {
    return NextResponse.json({ ok: true });
  }

  if (!(await assertOwner(id, userId))) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  // $1 is the playlist; ids start at $2 and their position is their index.
  const values = (trackIds as string[])
    .map((_, i) => `($${i + 2}::text, ${i})`)
    .join(", ");

  await execute(
    `UPDATE "PlaylistTrack" pt
        SET position = v.pos
       FROM (VALUES ${values}) AS v("trackId", pos)
      WHERE pt."playlistId" = $1 AND pt."trackId" = v."trackId"`,
    [id, ...(trackIds as string[])]
  );

  await invalidate(id, userId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { trackId } = await req.json();
  const userId = session.user.id!;

  if (!(await assertOwner(id, userId))) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const { rowCount } = await execute(
    `DELETE FROM "PlaylistTrack" WHERE "playlistId" = $1 AND "trackId" = $2`,
    [id, trackId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Track not in playlist" }, { status: 404 });
  }

  await invalidate(id, userId);
  return NextResponse.json({ ok: true });
}
