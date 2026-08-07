import { NextRequest, NextResponse } from "next/server";
import { execute, query } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { cacheDel, cacheKey } from "@/lib/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackIds } = await req.json();
  const userId = session.user.id!;

  if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
    return NextResponse.json({ error: "trackIds array is required" }, { status: 400 });
  }

  // Filter out any Deezer-only tracks since they must be downloaded/added to Postgres first to be favorited
  // Actually, we could add them, but for now we only favorite tracks in Postgres
  const validIds = trackIds.filter(id => !id.startsWith("deezer-"));

  if (validIds.length === 0) {
    return NextResponse.json({ liked: true }); // Nothing to do but pretend success
  }

  // Construct a bulk insert
  const values = validIds.map((_, i) => `($1, $${i + 2})`).join(", ");
  const params = [userId, ...validIds];

  await execute(
    `INSERT INTO "Favorite" ("userId", "trackId") VALUES ${values} ON CONFLICT DO NOTHING`,
    params
  );

  await cacheDel(cacheKey("favorites", userId), cacheKey("home", userId));
  return NextResponse.json({ liked: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackIds } = await req.json();
  const userId = session.user.id!;

  if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
    return NextResponse.json({ error: "trackIds array is required" }, { status: 400 });
  }

  const validIds = trackIds.filter(id => !id.startsWith("deezer-"));

  if (validIds.length === 0) {
    return NextResponse.json({ unliked: true });
  }

  const placeholders = validIds.map((_, i) => `$${i + 2}`).join(", ");
  const params = [userId, ...validIds];

  await execute(
    `DELETE FROM "Favorite" WHERE "userId" = $1 AND "trackId" IN (${placeholders})`,
    params
  );

  await cacheDel(cacheKey("favorites", userId), cacheKey("home", userId));
  return NextResponse.json({ unliked: true });
}
