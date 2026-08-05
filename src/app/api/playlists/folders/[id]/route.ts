import { NextRequest, NextResponse } from "next/server";
import { execute, queryOne } from "@/lib/sql";
import { auth } from "@/lib/auth";

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
  const { name } = await req.json();

  try {
    const folder = await queryOne(
      `SELECT id FROM "PlaylistFolder" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (name && typeof name === "string" && name.trim().length > 0) {
      await execute(
        `UPDATE "PlaylistFolder" SET name = $1 WHERE id = $2`,
        [name.trim(), id]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update folder:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
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

  try {
    const folder = await queryOne(
      `SELECT id FROM "PlaylistFolder" WHERE id = $1 AND "userId" = $2`,
      [id, userId]
    );

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    await execute(
      `UPDATE "Playlist" SET "folderId" = NULL WHERE "folderId" = $1`,
      [id]
    );

    await execute(
      `DELETE FROM "PlaylistFolder" WHERE id = $1`,
      [id]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete folder:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
