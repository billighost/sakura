import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const user = await queryOne(
    `SELECT id, username, email, "avatarUrl", bio, "createdAt", (SELECT COUNT(*) FROM "Playlist" WHERE "userId" = $1)::int as "playlistCount", (SELECT COUNT(*) FROM "Favorite" WHERE "userId" = $1)::int as "favoriteCount", (SELECT COUNT(*) FROM "ListeningHistory" WHERE "userId" = $1)::int as "historyCount" FROM "User" WHERE id = $1`,
    [userId]
  );

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

  if (username !== undefined) {
    fields.push(`username = $${idx++}`);
    values.push(username);
  }
  if (bio !== undefined) {
    fields.push(`bio = $${idx++}`);
    values.push(bio);
  }
  if (avatarUrl !== undefined) {
    fields.push(`"avatarUrl" = $${idx++}`);
    values.push(avatarUrl);
  }

  if (fields.length > 0) {
    values.push(userId);
    await execute(
      `UPDATE "User" SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
  }

  return NextResponse.json({ ok: true });
}
