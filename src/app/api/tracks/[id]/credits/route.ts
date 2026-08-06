import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const credits = await query(
      `SELECT id, name, role FROM "TrackCredit" WHERE "trackId" = $1 ORDER BY role, name`,
      [id]
    );

    const samples = await query(
      `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
       FROM "SampledTrack" st
       JOIN "Track" t ON st."sampledTrackId" = t.id
       LEFT JOIN "Artist" a ON t."artistId" = a.id
       WHERE st."trackId" = $1`,
      [id]
    );

    const sampledBy = await query(
      `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
       FROM "SampledTrack" st
       JOIN "Track" t ON st."trackId" = t.id
       LEFT JOIN "Artist" a ON t."artistId" = a.id
       WHERE st."sampledTrackId" = $1`,
      [id]
    );

    let finalCredits = credits;

    if (finalCredits.length === 0) {
      // Fallback to Deezer API if local DB has no credits
      let dzId = null;
      if (id.startsWith("deezer-")) {
        dzId = id.replace("deezer-", "");
      } else {
        // Look up deezerId for this local track
        const t = await query<{ deezerId: string | null }>(
          `SELECT "deezerId" FROM "Track" WHERE id = $1`,
          [id]
        );
        if (t.length > 0 && t[0].deezerId) {
          dzId = t[0].deezerId;
        }
      }

      if (dzId) {
        try {
          const res = await fetch(`https://api.deezer.com/track/${dzId}`, { next: { revalidate: 3600 } });
          const data = await res.json();
          if (data && data.contributors) {
            finalCredits = data.contributors.map((c: any) => ({
              id: `dz-contrib-${c.id}`,
              name: c.name,
              role: c.role || "Unknown",
            }));
          }
        } catch (err) {
          console.error("Failed to fetch Deezer fallback credits:", err);
        }
      }
    }

    return NextResponse.json({ credits: finalCredits, samples, sampledBy });
  } catch (err) {
    console.error("Failed to fetch track credits:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
