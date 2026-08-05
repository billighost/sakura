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

    return NextResponse.json({ credits, samples, sampledBy });
  } catch (err) {
    console.error("Failed to fetch track credits:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
