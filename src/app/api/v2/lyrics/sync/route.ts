import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { cardsForIds } from "@/rebuild/data/catalog";
import { ProductError, uuid } from "@/rebuild/data/validation";
import { createHostedSync, HostedSyncError } from "@/rebuild/lyrics/hostedSync";
import { resolveVerifiedLyrics } from "@/rebuild/lyrics/service";
import { recordingLyricIdentity } from "@/rebuild/lyrics/recordingIdentity";
import { LyricAlignmentError } from "@/rebuild/lyrics/whisperSync";
import { canAutoSync } from "@/rebuild/lyrics/autoSync";
import type { TimedLyric } from "@/rebuild/lyrics/parse";
import { SyncStartGate } from "@/rebuild/lyrics/syncStartGate";

export const maxDuration = 60;
const starts = new SyncStartGate();
export async function POST(request: NextRequest) {
  return withApiTiming("/api/v2/lyrics/sync", request, async () => {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const account = await requireRebuildAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    const raw = await request.text();
    if (raw.length > 70_000) throw new HostedSyncError("Auto-sync input is too large.", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new HostedSyncError("Invalid JSON.", 400); }
    if (!body || typeof body !== "object") throw new HostedSyncError("Invalid sync request.", 400);
    const worker = createHostedSync({ url: process.env.SAKURA_LYRICS_SYNC_URL || "", secret: process.env.SAKURA_SYNC_SECRET || "" });
    if (body.jobToken) {
      const reply = await worker.poll(account.id, body.jobToken, request.signal);
      return NextResponse.json(reply, { headers: { ...headers, ...(reply.status === "pending" ? { "Retry-After": String(Math.ceil(reply.retryAfterMs / 1000)) } : {}) } });
    }
    const recordingId = uuid(body.recordingId, "recording ID");
    const supplied = body.lines;
    if (!Array.isArray(supplied) || supplied.length > 400 || !supplied.every(line => line && typeof line.text === "string" && line.start === 0 && (line.end === undefined || line.end === 0)))
      throw new HostedSyncError("Verified plain lyrics are required for auto sync.", 400);
    if (!canAutoSync(supplied)) throw new HostedSyncError("Auto sync currently supports English lyrics.", 422);
    const start = starts.reserve(account.id);
    try {
    const track = (await cardsForIds(account.id, [recordingId]))[0], audio = track?.readyPlayback;
    if (!track || !audio) throw new HostedSyncError("Play a recording with an existing verified full audio file before using auto sync.", 409);
    if (!canAutoSync(supplied, typeof track.metadata.language === "string" ? track.metadata.language : undefined)) throw new HostedSyncError("Auto sync currently supports English lyrics.", 422);
    const source = await resolveVerifiedLyrics(recordingLyricIdentity({ ...track, recordingId }), true, request.signal);
    if (source.status !== "matched" || source.track.instrumental || !source.track.plainLyrics
      || JSON.stringify(source.track.plainLyrics.split(/\r?\n/)) !== JSON.stringify(supplied.map(line => line.text)))
      throw new HostedSyncError("The plain lyrics changed or could not be verified. Refresh them before auto syncing.", 409);
    const reply = await worker.start(account.id, { recordingId, audioUrl: audio.url, audioSha256: audio.sha256, sizeBytes: audio.sizeBytes, durationSeconds: (audio.durationMs || track.durationMs || 0) / 1000 }, supplied as TimedLyric[], request.signal);
    start.accepted();
    return NextResponse.json(reply, { headers });
    } finally { start.release(); }
  } catch (error) {
    if (error instanceof HostedSyncError || error instanceof ProductError) {
      const reason=!process.env.SAKURA_LYRICS_SYNC_URL||!process.env.SAKURA_SYNC_SECRET?"lyrics-sync-not-configured":error.status===409?"lyrics-sync-source":error.status===410?"lyrics-sync-expired":error.status===429?"lyrics-sync-busy":error.status===422?"lyrics-sync-language":"lyrics-sync-unavailable";
      const retryAfterMs = error instanceof HostedSyncError ? error.retryAfterMs : undefined;
      return NextResponse.json({ error: error.message,reason, ...(retryAfterMs ? { retryAfterMs } : {}) }, { status: error.status, headers: { ...headers, ...(retryAfterMs ? { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } : {}) } });
    }
    if (error instanceof LyricAlignmentError) return NextResponse.json({ error: error.message,reason:"lyrics-sync-uncertain" }, { status: 422, headers });
    return NextResponse.json({ error: "The free auto-sync worker is temporarily unavailable. Your plain lyrics have been kept.",reason:"lyrics-sync-unavailable" }, { status: 503, headers });
  }

  });
}
