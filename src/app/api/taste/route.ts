import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/sql";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import {
  ensureTasteProfile,
  saveOnboarding,
  recomputeTaste,
  recordFeedback,
  getTasteProfile,
} from "@/lib/taste";

/** GET — the current taste profile, with names resolved for display. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  const profile = await ensureTasteProfile(userId);

  // Resolve artist ids to names so the client doesn't need a second round trip.
  const artistIds = [...new Set([...profile.topArtistIds, ...profile.seedArtistIds])].slice(0, 40);
  const artists = artistIds.length
    ? await query<{ id: string; name: string; imageUrl: string | null }>(
        `SELECT id, name, "imageUrl" FROM "Artist" WHERE id = ANY($1::text[])`,
        [artistIds]
      ).catch(() => [])
    : [];

  const nameById = new Map(artists.map((a) => [a.id, a]));

  return NextResponse.json({
    onboarded: profile.onboarded,
    discovery: profile.discovery,
    topGenres: profile.topGenres,
    topArtists: profile.topArtistIds.map((id) => nameById.get(id)).filter(Boolean),
    seedGenres: profile.seedGenres,
    seedArtists: profile.seedArtistIds.map((id) => nameById.get(id)).filter(Boolean),
    eraCenter: profile.eraCenter,
    skipRate: Math.round(profile.skipRate * 100) / 100,
    totalPlays: profile.totalPlays,
    computedAt: profile.computedAt,
  });
}

/** POST — submit onboarding selections. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const genres: string[] = Array.isArray(body?.genres)
    ? body.genres.filter((g: unknown) => typeof g === "string")
    : [];
  const artistIds: string[] = Array.isArray(body?.artistIds)
    ? body.artistIds.filter((a: unknown) => typeof a === "string")
    : [];
  const artistNames: string[] = Array.isArray(body?.artistNames)
    ? body.artistNames.filter((a: unknown) => typeof a === "string")
    : [];
  const discovery = typeof body?.discovery === "number" ? body.discovery : 0.35;
  const skipped = body?.skipped === true;

  // A skip still marks them onboarded. Asking again on every visit would be
  // more annoying than a cold-start profile is costly — the engine learns
  // from behaviour regardless, it just takes a little longer to warm up.
  if (!skipped && genres.length === 0 && artistIds.length === 0 && artistNames.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one genre or artist" },
      { status: 400 }
    );
  }

  await saveOnboarding(userId, { genres, artistIds, artistNames, discovery });

  const profile = await getTasteProfile(userId);
  return NextResponse.json({ ok: true, onboarded: true, topGenres: profile?.topGenres ?? [] });
}

/** PATCH — adjust settings or record explicit feedback without re-onboarding. */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Explicit feedback: { target: "artist", targetId: "...", kind: "ban" }
  if (body?.target && body?.targetId && body?.kind) {
    const validTargets = ["track", "artist", "genre"];
    const validKinds = ["love", "ban", "more", "less"];
    if (!validTargets.includes(body.target) || !validKinds.includes(body.kind)) {
      return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
    }
    await recordFeedback(userId, body.target, String(body.targetId), body.kind);
    return NextResponse.json({ ok: true });
  }

  // Manual recompute — useful after a big import, and the most expensive
  // thing this route can do, so it gets the tighter limit.
  if (body?.recompute) {
    const limited = await rateLimit(`taste:${userId}`, LIMITS.taste.limit, LIMITS.taste.window);
    if (!limited.allowed) return rateLimitResponse(limited);

    const profile = await recomputeTaste(userId);
    return NextResponse.json({ ok: true, topGenres: profile.topGenres });
  }

  return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
}
