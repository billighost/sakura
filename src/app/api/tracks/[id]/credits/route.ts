import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { cacheKey, cacheGetStale, cacheSetStale, cached, TTL } from "@/lib/cache";
import { callProvider, HttpError } from "@/lib/resilience";

type Credit = { id: string; name: string; role: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    /**
     * The three local reads are independent, so they run together rather than
     * one after another. Sequentially they cost three full database round trips
     * — on a remote Postgres that was three times the latency and three pool
     * slots held in series, for no reason other than the order they were
     * written in.
     *
     * The whole assembled result is then cached: credits, samples and
     * sampled-by are historical facts about a recording, and the only thing
     * that changes them is re-importing the track.
     */
    const result = await cached(cacheKey("credits:local", id), TTL.TRACK_CREDITS, async () => {
      const [credits, samples, sampledBy] = await Promise.all([
        query(
          `SELECT id, name, role FROM "TrackCredit" WHERE "trackId" = $1 ORDER BY role, name`,
          [id]
        ),
        query(
          `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
           FROM "SampledTrack" st
           JOIN "Track" t ON st."sampledTrackId" = t.id
           LEFT JOIN "Artist" a ON t."artistId" = a.id
           WHERE st."trackId" = $1`,
          [id]
        ),
        query(
          `SELECT st."sampleType", t.id as "trackId", t.title as "trackTitle", a.name as "artistName"
           FROM "SampledTrack" st
           JOIN "Track" t ON st."trackId" = t.id
           LEFT JOIN "Artist" a ON t."artistId" = a.id
           WHERE st."sampledTrackId" = $1`,
          [id]
        ),
      ]);
      return { credits, samples, sampledBy };
    });

    let finalCredits = result.credits;
    const { samples, sampledBy } = result;

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
        const cachedCredits = await cacheGetStale<Credit[]>(cKey);
        if (cachedCredits && cachedCredits.fresh) {
          finalCredits = cachedCredits.value;
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
          } else if (cachedCredits) {
            // Provider is down or breaker is open — serve the stale copy
            // rather than pretending the track has no credits.
            finalCredits = cachedCredits.value;
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
