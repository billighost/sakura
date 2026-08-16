import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheKey,
  bumpNamespace,
  TTL,
} from "@/lib/cache";

/**
 * Read a playlist.
 *
 * Now readable by someone who doesn't own it, provided it's public. It used to
 * filter `WHERE id = $1 AND "userId" = $2` unconditionally, which meant
 * `Playlist.isPublic` — a column, a migration and a toggle on the profile page —
 * could be switched on and change nothing observable: the only person who could
 * ever load the playlist was the one person who didn't need permission.
 *
 * `isOwner` is computed outside the cache and the cached payload is identical for
 * everyone, so one viewer's cache entry can't leak an edit affordance to another.
 */
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
  const key = cacheKey("playlist", id);

  const cached = await cacheGet<{ userId: string; isPublic?: boolean }>(key);
  if (cached) {
    if (cached.userId !== userId && !cached.isPublic) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ...cached, isOwner: cached.userId === userId },
      { headers: { "X-Cache": "HIT" } }
    );
  }

  const playlist = await queryOne<{ userId: string; isPublic?: boolean }>(
    `SELECT p.*, u.name AS "ownerName"
       FROM "Playlist" p
       LEFT JOIN "User" u ON u.id = p."userId"
      WHERE p.id = $1`,
    [id]
  );

  // Same 404 for "doesn't exist" and "not yours and not public": telling the
  // difference would confirm the existence of private playlists by id.
  if (!playlist || (playlist.userId !== userId && !playlist.isPublic)) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const tracks = await query(
    `SELECT t.id, t.title, t.duration, t."audioUrl", t."coverUrl",
       json_build_object('name', a.name) as artist,
       json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album,
       pt.position
     FROM "PlaylistTrack" pt
     JOIN "Track" t ON pt."trackId" = t.id
     LEFT JOIN "Artist" a ON t."artistId" = a.id
     LEFT JOIN "Album" al ON t."albumId" = al.id
     WHERE pt."playlistId" = $1
     ORDER BY pt.position ASC`,
    [id]
  );

  const result = { ...playlist, tracks };
  await cacheSet(key, result, TTL.PLAYLIST);
  return NextResponse.json({ ...result, isOwner: playlist.userId === userId });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { name, description, isPublic } = await req.json();
  const userId = session.user.id!;

  /*
   * Patch only the fields the caller actually sent.
   *
   * This used to be `SET name = $1, description = $2` unconditionally, which
   * made the handler destructive for any partial update: renaming a playlist
   * wiped its description, and a visibility-only toggle would have blanked
   * both. Build the SET list from present keys instead.
   */
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    fields.push(`name = $${idx++}`);
    values.push(name.trim().slice(0, 100));
  }
  if (description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(typeof description === "string" ? description.slice(0, 500) : null);
  }
  if (isPublic !== undefined) {
    fields.push(`"isPublic" = $${idx++}`);
    values.push(Boolean(isPublic));
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(id, userId);
  const { rowCount } = await execute(
    `UPDATE "Playlist" SET ${fields.join(", ")}
     WHERE id = $${idx++} AND "userId" = $${idx}`,
    values
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  await cacheDel(cacheKey("playlist", id), cacheKey("playlists", userId));
  // Visibility is read by search, which caches per query. Bumping the
  // namespace orphans every cached entity-search result in one command, so a
  // freshly published playlist is findable right away (and an unpublished one
  // stops showing up) without scanning the keyspace.
  if (isPublic !== undefined) {
    await bumpNamespace("search:entities");
  }
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
  const userId = session.user.id!;

  const { rowCount } = await execute(
    `DELETE FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, userId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  await cacheDel(cacheKey("playlist", id), cacheKey("playlists", userId));
  return NextResponse.json({ ok: true });
}
