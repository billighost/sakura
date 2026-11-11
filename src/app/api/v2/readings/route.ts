import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { createHash } from "node:crypto";
import { japaneseReadingCacheKey } from "@/rebuild/lyrics/japanese";
import { LyricRequestError, parseReadingRequest } from "@/rebuild/lyrics/request";
import { romanizeLyricLines } from "@/rebuild/lyrics/readings";
import { readingEngine } from "@/rebuild/lyrics/language";

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
    const lines = await romanizeLyricLines(input.lines, input.language);
    return NextResponse.json({
      recordingId: input.recordingId || null, language: input.language, engine: readingEngine(input.language),
      contentKey:input.language==="ja"?japaneseReadingCacheKey(input.lines.map(line=>line.text),input.recordingId):createHash("sha256").update(JSON.stringify([input.recordingId,input.language,readingEngine(input.language),input.lines])).digest("hex"),
      lines,
      quality: { method: input.language==="ja"||input.language==="zh"?"dictionary-assisted":"script-transliteration", reviewNeeded: lines.some((line) => line.readingReviewNeeded), note: "Unusual names and poetic readings may need review." },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LyricRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[v2/readings] generation failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Readings are temporarily unavailable" }, { status: 503 });
  }
}
