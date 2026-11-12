import { handlers } from "@/rebuild/auth-engine";
import type { NextRequest } from "next/server";
import { withApiTiming } from "@/rebuild/server/performance";

export async function GET(request: NextRequest) {
  return withApiTiming("/api/auth/[...nextauth]", request, () => handlers.GET(request));
}
export async function POST(request: NextRequest) {
  return withApiTiming("/api/auth/[...nextauth]", request, () => handlers.POST(request));
}
