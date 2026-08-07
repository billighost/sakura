import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { cacheKey, cacheGetStale, cacheSetStale, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

type Credit = { id: string; name: string; role: string };

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
        // Credits are a nice-to-have, so this whole block is best-effort:
        // callProvider returns null rather than throwing, and an empty credit
        // list renders fine.
        const cKey = cacheKey("credits", dzId);
        const cached = await cacheGetStale<Credit[]>(cKey);
        if (cached && cached.fresh) {
          finalCredits = cached.value;
        } else {
          const data = await callProvider<any>(
            async (signal) => {
              const url = `https://api.deezer.com/track/${dzId}`;
              const res = await fetch(url, { signal });
              if (!res.ok) throw new HttpError(res.status, url);
              return res.json();
            },
            { provider: "deezer", op: "track.credits", timeoutMs: 5000, attempts: 2 },
          );

          if (data?.contributors) {
            finalCredits = data.contributors.map((c: any) => ({
              id: `dz-contrib-${c.id}`,
              name: c.name,
              role: c.role || "Unknown",
            }));
            await cacheSetStale(cKey, finalCredits, TTL.credits);
          } else if (cached) {
            // Provider is down or breaker is open — serve the stale copy
            // rather than pretending the track has no credits.
            finalCredits = cached.value;
          }
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
