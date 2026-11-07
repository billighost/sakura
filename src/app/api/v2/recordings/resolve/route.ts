import { requireRebuildAccount } from "@/rebuild/auth";
import { after } from "next/server";
import { InputError } from "@/rebuild/server/contracts";
import { readResolveInput } from "@/rebuild/server/input";
import { getRebuildServices } from "@/rebuild/server/runtime";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const account = await requireRebuildAccount();
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    const input = await readResolveInput(request);
    const services = getRebuildServices();
    const result = await services.resolver.resolve(input, account.id, request.signal);
    if (result.status === "pending") after(() => services.jobs.process(result.jobId));
    const status = result.status === "pending" ? 202 : result.status === "resolved" ? 200 : result.status === "review" ? 409
      : result.reason === "catalog-not-found" ? 404 : result.reason === "backend-not-initialized" || result.reason === "provider-unavailable" ? 503 : 200;
    return Response.json(result, { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json({ status: "unavailable", reason: "backend-unavailable", retryable: true }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
