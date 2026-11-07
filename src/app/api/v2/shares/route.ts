import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildPool } from "@/rebuild/data/db";
import { parseTimedLyrics } from "@/rebuild/lyrics/parse";
import { resolveVerifiedLyrics } from "@/rebuild/lyrics/service";
import { parseShareInput, ShareInputError, verifyLyricSelection } from "@/rebuild/player/shareInput";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { sameRequestOrigin } from "@/rebuild/requestOrigin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest) {
  try {
    if (!sameRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    const account = await requireRebuildAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if(request.headers.get("X-Sakura-Account")&&request.headers.get("X-Sakura-Account")!==account.id)return NextResponse.json({error:"Session changed"},{status:401});
    const raw = await request.text();
    if (raw.length > 20_000) return NextResponse.json({ error: "Share is too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const input = parseShareInput(body);
    let recordingId = input.recordingId;
    if (!UUID.test(recordingId)) {
      if (!input.reference) return NextResponse.json({ error: "The exact catalog reference is required for this song." }, { status: 409 });
      const verified = await getRebuildServices().ingestor.ensureRecording(input.reference, undefined, request.signal);
      recordingId = verified.recordingId;
    }
    const rows = await getRebuildPool().query(`SELECT id, metadata, provenance,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',provider,'id',external_id)) FROM sakura_v2."ExternalReference" WHERE recording_id = r.id AND provider IN ('deezer','spotify') AND verified_at IS NOT NULL),'[]'::jsonb) AS references
      FROM sakura_v2."Recording" r WHERE id = $1::uuid AND state = 'verified'`, [recordingId]);
    const recording = rows.rows[0] as { id: string; metadata: Record<string, unknown>; references: Array<{ provider: string; id: string }>; provenance?: { catalog?: Record<string, unknown> } } | undefined;
    if (!recording) return NextResponse.json({ error: "This recording is unavailable" }, { status: 404 });
    const metadata = recording.metadata;
    const title = String(metadata.title || "");
    const artists = Array.isArray(metadata.artists) ? metadata.artists.map(String) : [];
    const albumTitle = typeof metadata.albumTitle === "string" ? metadata.albumTitle : typeof recording.provenance?.catalog?.albumTitle === "string" ? recording.provenance.catalog.albumTitle : null;
    let lines = input.kind === "lyric" ? input.lines : [];
    if (input.kind === "lyric") {
      const resolved = await resolveVerifiedLyrics({ recordingId: recording.id, title, artist: artists[0] || "", album: albumTitle || undefined, durationSeconds: typeof metadata.durationMs === "number" ? metadata.durationMs / 1000 : undefined,
        language: lines.some((line) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.text)) ? "ja" : undefined });
      if (resolved.status !== "matched") return NextResponse.json({ error: "These lyrics could not be verified for this recording." }, { status: 409 });
      const source = resolved.track.syncedLyrics ? parseTimedLyrics(resolved.track.syncedLyrics) : (resolved.track.plainLyrics || "").split(/\r?\n/).map((text) => ({ text, start: 0 }));
      if (!verifyLyricSelection(lines, source)) return NextResponse.json({ error: "Choose neighbouring lines from this recording's current lyrics." }, { status: 409 });
      lines = lines.map((line) => source.find((original) => original.text === line.text && original.start === line.start)!);
    }
    const payload = { recordingId: recording.id, title, artists, albumTitle, durationMs: metadata.durationMs || 0, references: recording.references, reference: recording.references.find((ref) => ref.provider === "deezer") || recording.references[0] || null,
      coverUrl: typeof metadata.coverUrl === "string" ? metadata.coverUrl : recording.provenance?.catalog?.coverUrl || null,
      version: metadata.version || null, lines, colorMode: input.colorMode, style: "ink", schemaVersion: "sakura-share-v1" };
    const slug = randomBytes(12).toString("base64url");
    await getRebuildPool().query('INSERT INTO sakura_v2."Share" (slug, account_id, recording_id, kind, payload) VALUES ($1,$2::uuid,$3::uuid,$4,$5::jsonb)', [slug, account.id, recording.id, input.kind, JSON.stringify(payload)]);
    return NextResponse.json({ slug, url: `/s/${slug}`, payload }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ShareInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[v2/shares] create failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Your share could not be saved. Please try again." }, { status: 503 });
  }
}
