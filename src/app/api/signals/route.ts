import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { queryOne } from "@/lib/sql";
import { recordPlaySignals, recomputeTaste, type PlaySignal } from "@/lib/taste";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

/**
 * Play-signal ingestion.
 *
 * The client batches events and flushes them here — on track change, on tab
 * hide, and on a timer. Batching matters: a listening session generates an
 * event every few minutes, and one request per event would be pure overhead.
 *
 * Recomputation is throttled separately from ingestion. Writing signals is
 * cheap; rebuilding a taste profile is not, and doing it on every flush would
 * mean a full recompute every few minutes per active listener.
 */

/** Don't recompute a profile more than once every few minutes. */
const RECOMPUTE_THROTTLE_SECONDS = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  const limited = await rateLimit(`signals:${userId}`, LIMITS.signals.limit, LIMITS.signals.window);
  if (!limited.allowed) return rateLimitResponse(limited);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const signals: PlaySignal[] = Array.isArray(body)
    ? body
    : Array.isArray((body as any)?.signals)
      ? (body as any).signals
      : [];

  if (signals.length === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  // Respect private session — listening still plays, it just leaves no trace.
  const settings = await queryOne<{ privateSession: boolean }>(
    `SELECT "privateSession" FROM "UserSettings" WHERE "userId" = $1`,
    [userId]
  ).catch(() => null);

  if (settings?.privateSession) {
    return NextResponse.json({ recorded: 0, private: true });
  }

  const recorded = await recordPlaySignals(userId, signals);

  // Kick off a recompute at most every RECOMPUTE_THROTTLE_SECONDS, and only
  // after the response has flushed — the caller is a background flush that
  // doesn't need the result, and a rebuild takes long enough that awaiting it
  // would stall the beacon. `after()` rather than a floating promise so the
  // runtime is guaranteed to stay alive for it.
  const throttleKey = cacheKey("taste-recompute-lock", userId);
  const locked = await cacheGet(throttleKey);
  if (!locked && recorded > 0) {
    await cacheSet(throttleKey, "1", RECOMPUTE_THROTTLE_SECONDS);
    after(async () => {
      try {
        await recomputeTaste(userId);
      } catch (e) {
        console.error("[Signals] Background taste recompute failed:", e);
      }
    });
  }

  return NextResponse.json({ recorded });
}
