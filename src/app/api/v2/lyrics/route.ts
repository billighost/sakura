import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { parseTimedLyrics } from "@/rebuild/lyrics/parse";
import { LyricRequestError, parseLyricIdentity } from "@/rebuild/lyrics/request";
import { resolveVerifiedLyrics } from "@/rebuild/lyrics/service";

export async function GET(request: NextRequest) {
  try {
    const account = await requireRebuildAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const identity = parseLyricIdentity(request.nextUrl.searchParams);
    const result = await resolveVerifiedLyrics(identity);
    if (result.status !== "matched") {
      const status = result.status === "unavailable" ? 503 : result.status === "ambiguous" ? 409 : 404;
      return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
    }
    const track = result.track;
    return NextResponse.json({
      status: "matched", recordingId: identity.recordingId || null,
      provider: result.provider, providerTrackId: track.id,
      matchedRecording: { title: track.trackName, artist: track.artistName, album: track.albumName || null, durationSeconds: track.duration || null },
      instrumental: Boolean(track.instrumental),
      plainLyrics: track.plainLyrics || null,
      lines: track.syncedLyrics ? parseTimedLyrics(track.syncedLyrics) : (track.plainLyrics || "").split(/\r?\n/).map((text) => ({ text, start: 0 })),
      timing: track.syncedLyrics ? "synced" : "plain",
      schemaVersion: "verified-lyrics-v2",
    }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    if (error instanceof LyricRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[v2/lyrics] resolution failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ status: "unavailable", error: "Lyrics are temporarily unavailable" }, { status: 503 });
  }
}
