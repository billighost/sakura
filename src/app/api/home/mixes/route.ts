import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateUserMixes } from "@/lib/mixes";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

/**
 * Force a mix regeneration for the signed-in user.
 *
 * The generation logic itself lives in `@/lib/mixes` — importing a route
 * handler from other server code (as this file used to be) makes the
 * dependency graph confusing and drags route-module concerns into plain
 * library calls.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Regeneration runs a dozen scoring queries; it should not be spammable.
  const limited = await rateLimit(
    `mixes:${session.user.id}`,
    LIMITS.mixes.limit,
    LIMITS.mixes.window
  );
  if (!limited.allowed) return rateLimitResponse(limited);

  try {
    const count = await generateUserMixes(session.user.id!);
    return NextResponse.json({ ok: true, mixes: count });
  } catch (err) {
    console.error("[Mixes] Generation failed:", err);
    return NextResponse.json({ error: "Failed to generate mixes" }, { status: 500 });
  }
}
