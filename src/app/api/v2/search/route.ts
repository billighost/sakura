import { withApiTiming } from "@/rebuild/server/performance";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import type { CatalogSearchKind } from "@/rebuild/server/catalog";
export async function GET(request: Request) {
  return withApiTiming("/api/v2/search", request, async () => {
  const params=new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 200) return Response.json({ error: "Search query is too long" },{ status: 400 });
  const rawKind=params.get("kind"),rawCursor=params.get("cursor");
  const kind=rawKind===null?undefined:["tracks","artists","albums"].includes(rawKind)?rawKind as CatalogSearchKind:null;
  if(kind===null||rawCursor!==null&&!/^\d{1,2}$/.test(rawCursor)||rawCursor!==null&&Number(rawCursor)>19)return Response.json({error:"Invalid search page"},{status:400});
  try {
    const account = await requireRebuildAccount();
    if (!account) return Response.json({ error: "Unauthorized" },{ status: 401 });
    return Response.json(await getRebuildServices().catalog.search(query,request.signal,{kind,cursor:rawCursor===null?undefined:Number(rawCursor)}),{ headers: { "Cache-Control": "private, max-age=30" } });
  }
  catch { return Response.json({ error: "Search is temporarily unavailable.",query,tracks: [],artists: [],albums: [],totals:{tracks:0,artists:0,albums:0},nextCursors:{tracks:null,artists:null,albums:null} },{ status: 503 }); }

  });
}
