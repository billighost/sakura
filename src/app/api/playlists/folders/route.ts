import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;

  try {
    const folders = await query(
      `SELECT
        pf.*,
        COUNT(p.id)::int AS "playlistCount"
      FROM "PlaylistFolder" pf
      LEFT JOIN "Playlist" p ON p."folderId" = pf.id
      WHERE pf."userId" = $1
      GROUP BY pf.id
      ORDER BY pf.name ASC`,
      [userId]
    );

    return NextResponse.json(folders);
  } catch (err) {
    console.error("Failed to fetch folders:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { name } = await req.json();

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
  }

  try {
    const folder = await queryOne(
      `INSERT INTO "PlaylistFolder" (id, "userId", name, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, NOW())
       RETURNING *`,
      [userId, name.trim()]
    );

    return NextResponse.json(folder);
  } catch (err) {
    console.error("Failed to create folder:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
