import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildRadio } from "@/lib/radio";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

/**
 * Radio continuation — "the queue ran out, keep the music going".
 *
 * POST rather than GET because the client sends the tracks already in its
 * queue as exclusions, and that list can be long enough to be awkward in a
 * query string.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  const limited = await rateLimit(`radio:${userId}`, LIMITS.radio.limit, LIMITS.radio.window);
  if (!limited.allowed) return rateLimitResponse(limited);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine — it means "just give me something to play".
  }

  const limit = Math.min(50, Math.max(1, Number(body?.limit) || 20));
  const seedTrackId = typeof body?.seedTrackId === "string" ? body.seedTrackId : null;
  const excludeTrackIds = Array.isArray(body?.excludeTrackIds)
    ? body.excludeTrackIds.filter((x: unknown) => typeof x === "string").slice(0, 500)
    : [];

  try {
    const tracks = await buildRadio(userId, { limit, seedTrackId, excludeTrackIds });
    return NextResponse.json({ tracks });
  } catch (err) {
    console.error("[Radio] Failed to build radio:", err);
    return NextResponse.json({ tracks: [] }, { status: 200 });
  }
}
