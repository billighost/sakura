import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { parseTimedLyrics } from "@/rebuild/lyrics/parse";
import { LyricRequestError, parseLyricIdentity } from "@/rebuild/lyrics/request";
import { resolveVerifiedLyrics } from "@/rebuild/lyrics/service";
import { VERIFIED_LYRICS_VERSION } from "@/rebuild/lyrics/versions";
import { registerPublicReadingSource } from "@/rebuild/lyrics/publicReadingSources";

export async function GET(request: NextRequest) {
  return withApiTiming("/api/v2/lyrics", request, async () => {
  try {
    const account = await requireRebuildAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const identity = parseLyricIdentity(request.nextUrl.searchParams);
    const result = await resolveVerifiedLyrics(identity, request.nextUrl.searchParams.get("refresh")==="1");
    if (result.status !== "matched") {
      const status = result.status === "unavailable" ? 503 : result.status === "ambiguous" ? 409 : 404;
      return NextResponse.json(result, { status, headers: { "Cache-Control": "private, no-store", ...(result.status === "unavailable" ? {"Retry-After": String(Math.max(1, Math.ceil((result.retryAfterMs || 5000) / 1000)))} : {}) } });
    }
    const track = result.track;
    const synced = track.syncedLyrics ? parseTimedLyrics(track.syncedLyrics) : [];
    const hasSyncedWords = synced.some(line => line.text.trim());
    const lines = hasSyncedWords ? synced : (track.plainLyrics || "").split(/\r?\n/).map((text) => ({ text, start: 0 }));
    const publicReadingProof = registerPublicReadingSource(lines.map(line => line.text), { provider: result.provider, providerTrackId: track.id });
    return NextResponse.json({
      status: "matched", recordingId: identity.recordingId || null,
      provider: result.provider, providerTrackId: track.id,
      matchedRecording: { title: track.trackName, artist: track.artistName, album: track.albumName || null, durationSeconds: track.duration || null },
      instrumental: Boolean(track.instrumental),
      plainLyrics: track.plainLyrics || null,
      lines,
      ...(publicReadingProof ? { publicReadingProof } : {}),
      timing: hasSyncedWords ? "synced" : "plain",
      schemaVersion: VERIFIED_LYRICS_VERSION,
    }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    if (error instanceof LyricRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[v2/lyrics] resolution failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ status: "unavailable", error: "Lyrics are temporarily unavailable" }, { status: 503, headers: {"Cache-Control": "private, no-store", "Retry-After": "5"} });
  }

  });
}
