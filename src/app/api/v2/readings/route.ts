import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { JAPANESE_READING_VERSION, japaneseReadingCacheKey, romanizeJapaneseLines } from "@/rebuild/lyrics/japanese";
import { LyricRequestError, parseReadingRequest } from "@/rebuild/lyrics/request";

export async function POST(request: NextRequest) {
  try {
    const account = await requireRebuildAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Bound decoded body size as well as line count and total lyric characters.
    const raw = await request.text();
    if (raw.length > 120_000) return NextResponse.json({ error: "Reading request is too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const input = parseReadingRequest(body);
    const lines = await romanizeJapaneseLines(input.lines);
    return NextResponse.json({
      recordingId: input.recordingId || null, language: "ja", engine: JAPANESE_READING_VERSION,
      contentKey: japaneseReadingCacheKey(input.lines.map((line) => line.text), input.recordingId),
      lines,
      quality: { method: "dictionary-assisted", reviewNeeded: lines.some((line) => line.readingReviewNeeded), note: "Unusual names and poetic readings may need review." },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LyricRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[v2/readings] generation failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Readings are temporarily unavailable" }, { status: 503 });
  }
}
