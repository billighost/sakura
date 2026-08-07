import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";

/**
 * Cross-device playback continuity.
 *
 * One row per user, last-writer-wins. Deliberately *not* a real-time sync
 * protocol — the requirement is "pick up where I left off on another device",
 * not "two devices playing in lockstep", and a CRDT for something a person can
 * only meaningfully do in one place at a time would be a lot of machinery for
 * no user-visible gain.
 *
 * The `deviceId` round-trip is what stops a device clobbering itself: a client
 * ignores incoming state it wrote, so a stale in-flight PUT can't rewind a
 * position that has since moved on locally.
 */

/** Queue payloads are capped so one user can't push an unbounded blob. */
const MAX_QUEUE_ITEMS = 200;

type QueueTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration?: number;
};

/**
 * Keep only the fields the receiving device needs to render a queue row.
 * Anything else is either resolvable locally or shouldn't cross the wire.
 */
function sanitiseQueue(input: unknown): QueueTrack[] {
  if (!Array.isArray(input)) return [];

  return input.slice(0, MAX_QUEUE_ITEMS).flatMap((raw): QueueTrack[] => {
    if (!raw || typeof raw !== "object") return [];
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== "string" || !t.id) return [];

    return [
      {
        id: t.id,
        title: typeof t.title === "string" ? t.title.slice(0, 300) : "",
        artist: typeof t.artist === "string" ? t.artist.slice(0, 300) : "",
        album: typeof t.album === "string" ? t.album.slice(0, 300) : undefined,
        coverUrl: typeof t.coverUrl === "string" ? t.coverUrl.slice(0, 1000) : undefined,
        // audioUrl is intentionally dropped — it can be a signed/expiring URL,
        // and the receiving device must resolve playback against its own
        // downloads and its own session anyway.
        duration: typeof t.duration === "number" ? t.duration : undefined,
      },
    ];
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await queryOne(
    `SELECT "trackId", "positionMs", "durationMs", "isPlaying",
            "queue", "upNext", "queueIndex", "shuffle", "repeat",
            "context", "contextId", "deviceId", "updatedAt"
       FROM "PlaybackState"
      WHERE "userId" = $1`,
    [session.user.id!]
  );

  if (!state) return NextResponse.json({ state: null });

  return NextResponse.json(
    { state },
    {
      headers: {
        // Per-user and changes constantly — must never be cached by a shared
        // hop, and revalidating it is cheaper than serving a stale position.
        "Cache-Control": "private, no-store",
      },
    }
  );
}

export async function PUT(req: NextRequest) {
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

  const trackId = typeof body.trackId === "string" ? body.trackId : null;
  const positionMs = Math.max(0, Math.floor(Number(body.positionMs) || 0));
  const durationMs = Math.max(0, Math.floor(Number(body.durationMs) || 0));
  const queueIndex = Math.max(0, Math.floor(Number(body.queueIndex) || 0));
  const isPlaying = body.isPlaying === true;
  const shuffle = body.shuffle === true;
  const repeat = ["off", "one", "all"].includes(String(body.repeat))
    ? String(body.repeat)
    : "off";

  const queue = sanitiseQueue(body.queue);
  const upNext = sanitiseQueue(body.upNext);

  const context = typeof body.context === "string" ? body.context.slice(0, 40) : null;
  const contextId = typeof body.contextId === "string" ? body.contextId.slice(0, 100) : null;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : null;

  await execute(
    `INSERT INTO "PlaybackState"
       ("userId","trackId","positionMs","durationMs","isPlaying",
        "queue","upNext","queueIndex","shuffle","repeat",
        "context","contextId","deviceId","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT ("userId") DO UPDATE SET
       "trackId"    = EXCLUDED."trackId",
       "positionMs" = EXCLUDED."positionMs",
       "durationMs" = EXCLUDED."durationMs",
       "isPlaying"  = EXCLUDED."isPlaying",
       "queue"      = EXCLUDED."queue",
       "upNext"     = EXCLUDED."upNext",
       "queueIndex" = EXCLUDED."queueIndex",
       "shuffle"    = EXCLUDED."shuffle",
       "repeat"     = EXCLUDED."repeat",
       "context"    = EXCLUDED."context",
       "contextId"  = EXCLUDED."contextId",
       "deviceId"   = EXCLUDED."deviceId",
       "updatedAt"  = NOW()`,
    [
      userId,
      trackId,
      positionMs,
      durationMs,
      isPlaying,
      JSON.stringify(queue),
      JSON.stringify(upNext),
      queueIndex,
      shuffle,
      repeat,
      context,
      contextId,
      deviceId,
    ]
  );

  return NextResponse.json({ ok: true });
}
