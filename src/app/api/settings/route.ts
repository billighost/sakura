import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

const ALLOWED_FIELDS = [
  "theme",
  "audioQuality",
  "downloadQuality",
  "crossfadeSeconds",
  "autoDownloadLiked",
  "gaplessPlayback",
  "normalizeVolume",
  "explicitContent",
  "privateSession",
  "pushNotifications",
  "newReleaseAlerts",
] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await queryOne(
    `SELECT * FROM "UserSettings" WHERE "userId" = $1`,
    [session.user.id!]
  );

  // Return null-safe defaults when the row doesn't exist yet (first-time user)
  if (!settings) {
    return NextResponse.json({
      /*
       * Null, not "dark".
       *
       * A first-time user has expressed no preference, and saying "dark" here
       * was indistinguishable from saying "this account chose dark" — so the
       * settings page adopted it and repainted the app, overriding whatever the
       * device was already showing. On a light-mode phone, opening Settings
       * turned the app dark. Null is the honest answer to "what did they pick?",
       * and the client leaves the device's own appearance alone when it sees one.
       * See the reconciliation note in app/(app)/settings/page.tsx.
       */
      theme: null,
      audioQuality: "high",
      downloadQuality: "high",
      crossfadeSeconds: 0,
      autoDownloadLiked: false,
      gaplessPlayback: true,
      normalizeVolume: true,
      explicitContent: true,
      privateSession: false,
      pushNotifications: true,
      newReleaseAlerts: true,
    });
  }

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  for (const key of ALLOWED_FIELDS) {
    if (key in body) data[key] = body[key];
  }

  const keys = Object.keys(data);
  if (keys.length > 0) {
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 2}`);
    const values = keys.map((k) => data[k]);
    await execute(
      `INSERT INTO "UserSettings" ("userId", ${keys.map((k) => `"${k}"`).join(", ")})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})
       ON CONFLICT ("userId") DO UPDATE SET ${setClauses.join(", ")}`,
      [userId, ...values]
    );
  }

  return NextResponse.json({ ok: true });
}
