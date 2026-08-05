import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";

export async function GET(req: NextRequest) {
  try {
    const globalTop = await query(
      `SELECT t.*, 
              (SELECT COUNT(*)::int FROM "ListeningHistory" lh WHERE lh."trackId" = t.id) as "playCount",
              json_build_object('name', a.name) as artist, 
              json_build_object('title', al.title, 'coverUrl', al."coverUrl") as album 
       FROM "Track" t 
       LEFT JOIN "Artist" a ON t."artistId" = a.id 
       LEFT JOIN "Album" al ON t."albumId" = al.id 
       ORDER BY "playCount" DESC, t."createdAt" DESC 
       LIMIT 50`
    );

    return NextResponse.json({ globalTop });
  } catch (err) {
    console.error("Failed to query top charts:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
