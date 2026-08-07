import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, queryOne, execute } from "@/lib/sql";
import { nanoid } from "@/lib/nanoid";

/**
 * Share creation.
 *
 * The caller submits a payload (kind, target track/playlist, lyric lines),
 * and this creates a durable row with a short slug. The slug is what goes in
 * the URL — not a UUID, because copying a link like `/s/xK9m2L` is far
 * friendlier than `/s/550e8400-e29b-...`.
 */

/** Generate a slug, retrying if we hit the one-in-a-billion collision. */
async function uniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = nanoid(7);
    const existing = await queryOne(
      `SELECT id FROM "Share" WHERE slug = $1`,
      [slug]
    );
    if (!existing) return slug;
  }
  // Fallback: longer ID. If this collides too, the universe owes us an explanation.
  return nanoid(12);
}

const VALID_KINDS = ["lyric", "track", "playlist", "album", "artist", "mix"] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = String(body.kind ?? "track");
  if (!VALID_KINDS.includes(kind as never)) {
    return NextResponse.json({ error: `Invalid kind. Use one of: ${VALID_KINDS.join(", ")}` }, { status: 400 });
  }

  const payload = typeof body.payload === "object" && body.payload !== null
    ? body.payload
    : {};

  const theme = typeof body.theme === "string" ? body.theme : "auto";
  const slug = await uniqueSlug();

  await execute(
    `INSERT INTO "Share" ("slug", "userId", "kind", "payload", "theme")
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [slug, userId, kind, JSON.stringify(payload), theme]
  );

  return NextResponse.json({
    slug,
    url: `${req.nextUrl.origin}/s/${slug}`,
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shares = await query(
    `SELECT slug, kind, payload, theme, views, "createdAt"
       FROM "Share"
      WHERE "userId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 40`,
    [session.user.id!]
  );

  return NextResponse.json(shares ?? []);
}
