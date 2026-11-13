import { withApiTiming } from "@/rebuild/server/performance";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { parseResolveInput, readRequestJson } from "@/rebuild/server/input";
import { RecordingIdentityConflict } from "@/rebuild/server/ingestion";
import { InputError } from "@/rebuild/server/contracts";

export async function POST(request: Request) {
  return withApiTiming("/api/v2/recordings/index/batch", request, async () => {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      const account = await requireRebuildAccount();
      if (!account) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
      const value = await readRequestJson(request);
      const items = value && typeof value === "object" && !Array.isArray(value)
        ? (value as { items?: unknown }).items : undefined;
      if (!Array.isArray(items) || !items.length || items.length > 50)
        throw new InputError("Indexing requires between one and fifty recordings");
      // Validate the entire batch before any provider/catalog work starts.
      const inputs = items.map(parseResolveInput);
      const recordings = await getRebuildServices().ingestor.ensureRecordings(inputs, request.signal);
      return Response.json({ recordings }, { headers });
    } catch (error) {
      if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400, headers });
      if (error instanceof RecordingIdentityConflict) return Response.json({ status: "review", reason: error.reason,
        error: error.message, candidates: error.candidates.map(recording => ({ title: recording.metadata.title,
          artists: recording.metadata.artists, durationMs: recording.metadata.durationMs ?? null,
          reference: recording.references?.find(ref => ref.provider === "deezer" || ref.provider === "spotify"),
          reasons: error.rejections })) }, { status: 409, headers });
      return Response.json({ error: "Could not index these recordings." }, { status: 503, headers });
    }
  });
}
