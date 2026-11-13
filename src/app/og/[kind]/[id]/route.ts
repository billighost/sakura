import { publicOgResponse } from "@/rebuild/og/production";

export async function GET(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await context.params;
  return publicOgResponse(request, kind, id);
}
