import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await queryOne(
    `SELECT * FROM "UserSettings" WHERE "userId" = $1`,
    [session.user.id!]
  );

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const body = await req.json();
  const allowed = ["theme", "audioQuality", "crossfadeSeconds", "autoDownloadLiked"];
  const data: Record<string, unknown> = {};

  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const keys = Object.keys(data);
  if (keys.length > 0) {
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 2}`);
    const values = keys.map((k) => data[k]);
    await execute(
      `INSERT INTO "UserSettings" ("userId", ${keys.map((k) => `"${k}"`).join(", ")}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) ON CONFLICT ("userId") DO UPDATE SET ${setClauses.join(", ")}`,
      [userId, ...values]
    );
  }

  return NextResponse.json({ ok: true });
}
