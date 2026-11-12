import { withApiTiming } from "@/rebuild/server/performance";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
export async function GET(request: Request,context: { params: Promise<{ kind: string; id: string }> }) {
  return withApiTiming("/api/v2/catalog/[kind]/[id]", request, async () => {
  const account = await requireRebuildAccount();
  if (!account) return Response.json({ error: "Unauthorized" },{ status: 401 });
  const { kind,id } = await context.params;
  if (kind !== "artist" && kind !== "album" && kind !== "playlist") return Response.json({ error: "Unknown catalogue collection" },{ status: 404 });
  if (!/^[1-9]\d{0,17}$/.test(id)) return Response.json({ error: "Invalid catalogue ID" },{ status: 400 });
  try { return Response.json(await getRebuildServices().catalog.detail(kind,id,request.signal),{ headers: { "Cache-Control": "private, max-age=120" } }); }
  catch { return Response.json({ error: "This collection is temporarily unavailable." },{ status: 503 }); }

  });
}
