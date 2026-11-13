import { withApiTiming } from "@/rebuild/server/performance";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";

export const maxDuration = 60;

async function serve(request: Request, context: { params: Promise<{ recordingId: string }> }, method: "GET" | "HEAD") {
  try {
    const account = await requireRebuildAccount();
    if (!account) return new Response(null, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    const { recordingId } = await context.params;
    const assetId = new URL(request.url).searchParams.get("assetId") ?? "";
    return await getRebuildServices().gateway.serve({ recordingId, assetId, accountId: account.id, range: request.headers.get("Range"), ifRange: request.headers.get("If-Range"), method, signal: request.signal, playback: method === "GET" && (request.headers.get("X-Sakura-Playback") === "1" || request.headers.get("Sec-Fetch-Dest") === "audio") });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ status: "unavailable", reason: "backend-unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function GET(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return withApiTiming("/api/v2/recordings/[recordingId]/audio", request, () => serve(request, context, "GET"));
}
export async function HEAD(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return withApiTiming("/api/v2/recordings/[recordingId]/audio", request, () => serve(request, context, "HEAD"));
}
