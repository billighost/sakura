import { after } from "next/server";
import { requireRebuildAccount } from "@/rebuild/auth";
import { getRebuildServices } from "@/rebuild/server/runtime";
import { isUuid } from "@/rebuild/server/input";
export const maxDuration = 120;
export async function GET(request: Request,context: { params: Promise<{ jobId: string }> }) {
  try {
    const account = await requireRebuildAccount();
    if (!account) return Response.json({ error: "Unauthorized" },{ status: 401,headers:{"Cache-Control":"private, no-store"} });
    const { jobId } = await context.params;
    if (!isUuid(jobId)) return Response.json({ error: "Invalid resolution job" },{ status: 400,headers:{"Cache-Control":"private, no-store"} });
    const services = getRebuildServices();
    const result = await services.jobs.get(jobId,account.id);
    if (!result) return Response.json({ error: "Resolution job not found" },{ status: 404 });
    if (result.status === "pending") after(() => services.jobs.process(jobId));
    return Response.json(result,{ status: result.status === "pending" ? 202 : result.status === "review" ? 409 : 200,headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ status: "unavailable",reason: "backend-unavailable",retryable: true },{ status: 503,headers:{"Cache-Control":"private, no-store"} }); }
}
