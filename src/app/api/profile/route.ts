import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet, cacheDel, cacheKey, TTL } from "@/lib/cache";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const key = cacheKey("profile", userId);

  const cached = await cacheGet(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
  }

  // Replace 3 correlated (SELECT COUNT(*)) subqueries with a single
  // LEFT JOIN aggregation — one pass over each table instead of three.
  const user = await queryOne(
    `SELECT
       u.id, u.username, u.email, u."avatarUrl", u.bio, u."createdAt",
       COALESCE(pl."playlistCount", 0)::int AS "playlistCount",
       COALESCE(fv."favoriteCount", 0)::int AS "favoriteCount",
       COALESCE(lh."historyCount", 0)::int AS "historyCount"
     FROM "User" u
     LEFT JOIN (
       SELECT "userId", COUNT(*)::int AS "playlistCount"
       FROM "Playlist" GROUP BY "userId"
     ) pl ON pl."userId" = u.id
     LEFT JOIN (
       SELECT "userId", COUNT(*)::int AS "favoriteCount"
       FROM "Favorite" GROUP BY "userId"
     ) fv ON fv."userId" = u.id
     LEFT JOIN (
       SELECT "userId", COUNT(*)::int AS "historyCount"
       FROM "ListeningHistory" GROUP BY "userId"
     ) lh ON lh."userId" = u.id
     WHERE u.id = $1`,
    [userId]
  );

  await cacheSet(key, user, TTL.PROFILE);
  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { username, bio, avatarUrl } = await req.json();

  if (username !== undefined) {
    if (typeof username !== "string" || username.length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    }
    const existing = await queryOne(
      `SELECT id FROM "User" WHERE username = $1 AND id != $2`,
      [username, userId]
    );
    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (username !== undefined) { fields.push(`username = $${idx++}`); values.push(username); }
  if (bio !== undefined)      { fields.push(`bio = $${idx++}`);       values.push(bio); }
  if (avatarUrl !== undefined){ fields.push(`"avatarUrl" = $${idx++}`);values.push(avatarUrl); }

  if (fields.length > 0) {
    values.push(userId);
    await execute(`UPDATE "User" SET ${fields.join(", ")} WHERE id = $${idx}`, values);
    await cacheDel(cacheKey("profile", userId));
  }

  return NextResponse.json({ ok: true });
}
