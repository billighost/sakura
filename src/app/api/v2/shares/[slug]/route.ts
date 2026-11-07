import { NextRequest, NextResponse } from "next/server";
import { getRebuildPool } from "@/rebuild/data/db";

export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[A-Za-z0-9_-]{16}$/.test(slug)) return NextResponse.json({ error: "Share not found" }, { status: 404 });
  try {
    const result = await getRebuildPool().query('SELECT slug, kind, payload, created_at FROM sakura_v2."Share" WHERE slug = $1 AND deleted_at IS NULL', [slug]);
    if (!result.rows[0]) return NextResponse.json({ error: "This shared moment is no longer available." }, { status: 404 });
    return NextResponse.json(result.rows[0], { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "This share is temporarily unavailable." }, { status: 503 });
  }
}
