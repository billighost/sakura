import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheDel, cacheKey } from "@/lib/cache";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await params;
  const userId = session.user.id!;
  
  const { rowCount } = await execute(
    `DELETE FROM "Favorite" WHERE "userId" = $1 AND "trackId" = $2`,
    [userId, trackId]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Not liked" }, { status: 404 });
  }

  await cacheDel(cacheKey("favorites", userId));
  return NextResponse.json({ liked: false });
}
