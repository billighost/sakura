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
    const snoozed = await query(
      `SELECT st.*, t.title, t."audioUrl"
       FROM "SnoozedTrack" st
       JOIN "Track" t ON st."trackId" = t.id
       WHERE st."userId" = $1 AND st."expiresAt" > NOW()
       ORDER BY st."snoozedAt" DESC`,
      [userId]
    );

    return NextResponse.json(snoozed);
  } catch (err) {
    console.error("Failed to fetch snoozed tracks:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { trackId } = await req.json();

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await queryOne(
      `INSERT INTO "SnoozedTrack" ("userId", "trackId", "snoozedAt", "expiresAt")
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT ("userId", "trackId") DO UPDATE
       SET "snoozedAt" = NOW(), "expiresAt" = $3`,
      [userId, trackId, expiresAt.toISOString()]
    );

    return NextResponse.json({ ok: true, expiresAt });
  } catch (err) {
    console.error("Failed to snooze track:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const { trackId } = await req.json();

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  try {
    await queryOne(
      `DELETE FROM "SnoozedTrack" WHERE "userId" = $1 AND "trackId" = $2`,
      [userId, trackId]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to unsnooze track:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
