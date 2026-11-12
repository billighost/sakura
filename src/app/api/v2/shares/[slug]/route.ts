import { withApiTiming } from "@/rebuild/server/performance";
import { NextRequest, NextResponse } from "next/server";
import { readPublicShare, validShareSlug } from "@/rebuild/data/shares";

export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  return withApiTiming("/api/v2/shares/[slug]", _request, async () => {
  const { slug } = await context.params;
  if (!validShareSlug(slug)) return NextResponse.json({ error: "Share not found" }, { status: 404 });
  try {
    const share = await readPublicShare(slug);
    if (!share) return NextResponse.json({ error: "This shared moment is no longer available." }, { status: 404 });
    return NextResponse.json(share, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "This share is temporarily unavailable." }, { status: 503 });
  }

  });
}
