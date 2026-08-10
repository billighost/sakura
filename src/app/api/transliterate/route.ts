import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cached, cacheKey } from "@/lib/cache";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import {
  SCRIPT_QUALITY,
  transliterateLines,
  type TransliterationScript,
} from "@/lib/transliterate";

/**
 * Romanise a set of lyric lines.
 *
 * Server-side because the Han reading table is ~430KB — shipping that to a
 * phone to romanise one chorus would be indefensible — and because the result
 * is worth caching across every user who plays the same song.
 *
 * The work itself is pure string transformation with no upstream call, so this
 * is cheap; the rate limit exists to stop a looping client burning CPU, not to
 * protect a third party.
 */

const TTL_SECONDS = 30 * 24 * 60 * 60;

/** Bounded so one request can't ask us to romanise a novel. */
const MAX_LINES = 400;
const MAX_CHARS = 20000;

const SUPPORTED = new Set<TransliterationScript>([
  "japanese",
  "korean",
  "chinese",
  "cyrillic",
  "arabic",
  "devanagari",
  "greek",
  "hebrew",
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(
    `translit:${session.user.id}`,
    LIMITS.transliterate.limit,
    LIMITS.transliterate.window
  );
  if (!limit.allowed) return rateLimitResponse(limit) as NextResponse;

  let body: { trackId?: unknown; script?: unknown; lines?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const script = String(body.script ?? "") as TransliterationScript;
  if (!SUPPORTED.has(script)) {
    return NextResponse.json(
      { error: `Sakura can't romanise ${script || "that script"} yet.` },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "lines are required" }, { status: 400 });
  }
  if (body.lines.length > MAX_LINES) {
    return NextResponse.json({ error: "Too many lines" }, { status: 413 });
  }

  const lines = body.lines
    .slice(0, MAX_LINES)
    .map((l) => (typeof l === "string" ? l : String((l as { text?: unknown })?.text ?? "")));

  const totalChars = lines.reduce((n, l) => n + l.length, 0);
  if (totalChars > MAX_CHARS) {
    return NextResponse.json({ error: "Lyrics too long to romanise" }, { status: 413 });
  }

  const trackId = typeof body.trackId === "string" ? body.trackId : "";

  /*
   * Keyed by track and script rather than by the lyric text. The text is the
   * real input, but it can run to 20KB and hashing it per request costs more
   * than the transliteration itself — while a track's lyrics don't change.
   * The line count is folded in so a later, more complete set of lyrics for
   * the same track doesn't collide with a truncated earlier one.
   */
  const key = cacheKey("translit", script, trackId || "adhoc", lines.length);

  const result = await cached(key, TTL_SECONDS, async () => ({
    lines: transliterateLines(
      lines.map((text) => ({ text })),
      script
    ),
    script,
    quality: SCRIPT_QUALITY[script],
  }));

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
