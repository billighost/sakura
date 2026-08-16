import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { enrichMusicBrainzAndSave, fillMissingCovers } from "@/lib/metadata";
import { getDeterministicTrackId } from "@/lib/deterministic";

interface IncomingTrack {
  title: string;
  artist: string;
  duration?: number;
  coverUrl?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { tracks, coverUrl: sourceCoverUrl } = await req.json();

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return NextResponse.json({ error: "Invalid tracks array" }, { status: 400 });
  }

  const playlist = await queryOne<{ id: string; coverUrl: string | null }>(
    `SELECT id, "coverUrl" FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, session.user.id!]
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    const maxRow = await queryOne<{ maxPos: number | null }>(
      `SELECT MAX(position) as "maxPos" FROM "PlaylistTrack" WHERE "playlistId" = $1`,
      [id]
    );
    let pos = (maxRow?.maxPos ?? -1) + 1;

    const incoming = tracks as IncomingTrack[];

    /*
     * Resolve the covers the source didn't supply, before any of them is written.
     *
     * This is the backstop for the bug this route used to help cause. Spotify's
     * embed payload has no per-track art for a playlist, and the importer papered
     * over that by handing every track the *playlist's* tile — which this route
     * then wrote into `Track.coverUrl`, so every song in the import showed the
     * playlist's artwork everywhere in the app. The resolvers no longer do that
     * (see lib/importLink.ts), which means covers arrive genuinely absent here,
     * and absent is what gets looked up: Deezer first, then iTunes.
     *
     * Awaited rather than fired and forgotten — this is a serverless handler, so
     * work started after the response is not guaranteed to run, and a cover
     * written nowhere is the same as no cover at all. The lookups are cached and
     * run six at a time, so a typical import adds a couple of seconds to a
     * request the user is already waiting on a spinner for.
     */
    const { filled, skipped } = await fillMissingCovers(incoming);
    if (skipped > 0) {
      console.log(
        `[batch import] resolved ${filled} covers; ${skipped} past the lookup bound left for playback enrichment`
      );
    }

    // Process all tracks
    const importedIds = [];

    /**
     * How many tracks per import get MusicBrainz enrichment. See the call site
     * below for why this is a small number and not `incoming.length`.
     */
    const MB_ENRICH_PER_IMPORT = 5;
    let enrichmentsQueued = 0;
    let enrichmentsDeferred = 0;

    /*
     * Playlist artwork.
     *
     * The source's own cover is the right answer when there is one — it's the
     * image the user recognises the playlist by. Only when the import didn't
     * carry one does this fall back to a 2×2 collage of the first four track
     * covers, stored as a JSON array the frontend unpacks (see
     * /api/playlists' GET mapping).
     */
    if (!playlist.coverUrl) {
      let coverStr: string | null =
        typeof sourceCoverUrl === "string" && sourceCoverUrl.trim()
          ? sourceCoverUrl.trim()
          : null;

      if (!coverStr) {
        const covers = [...new Set(incoming.map((t) => t.coverUrl).filter(Boolean))].slice(0, 4);
        if (covers.length > 0) {
          coverStr = covers.length === 1 ? (covers[0] as string) : JSON.stringify(covers);
        }
      }

      if (coverStr) {
        await execute(`UPDATE "Playlist" SET "coverUrl" = $1 WHERE id = $2`, [coverStr, id]);
      }
    }

    for (const track of incoming) {
      // Create Artist
      const artistId = (await queryOne<{ id: string }>(
        `INSERT INTO "Artist" (id, name, "createdAt")
         VALUES (gen_random_uuid()::text, $1, NOW())
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [track.artist]
      ))!.id;

      // Check for duplicate track by deterministic ID
      const trackId = getDeterministicTrackId(track.title, track.artist);
      let dbTrack = await queryOne<{ id: string }>(
        `SELECT id FROM "Track" WHERE id = $1 LIMIT 1`,
        [trackId]
      );

      if (!dbTrack) {
        dbTrack = await queryOne<{ id: string }>(
          `INSERT INTO "Track" (id, title, "artistId", duration, "audioUrl", source, "telegramMessageId", "coverUrl", "createdAt")
           VALUES ($1, $2, $3, $4, $5, 'telegram', '0', $6, NOW())
           RETURNING id`,
          [
            trackId,
            track.title,
            artistId,
            track.duration || 0,
            `/api/stream/telegram/0`, // 0 means it will be auto-downloaded on first play
            track.coverUrl || null,
          ]
        );
      } else {
         // Update cover if it was missing
         if (track.coverUrl) {
            await execute(`UPDATE "Track" SET "coverUrl" = $1 WHERE id = $2 AND "coverUrl" IS NULL`, [track.coverUrl, dbTrack.id]);
         }
      }

      // Insert into PlaylistTrack
      await execute(
        `INSERT INTO "PlaylistTrack" ("playlistId", "trackId", position) VALUES ($1, $2, $3)
         ON CONFLICT ("playlistId", "trackId") DO NOTHING`,
        [id, dbTrack!.id, pos]
      );

      pos++;
      importedIds.push(dbTrack!.id);

      /*
       * MusicBrainz enrichment, after the response, for the first few tracks only.
       *
       * MB allows ~1 request/second and enrichment costs 2-3 requests per track,
       * so a 50-track import wants ~150 seconds of paced requests — an order of
       * magnitude past this function's lifetime. The pacer would shed the excess
       * on its own, but silently, and a queue overflow reads like a bug rather
       * than arithmetic. Bounding it here makes the tradeoff visible and leaves
       * the rest to be enriched on first play, which is when the data is wanted.
       */
      if (enrichmentsQueued < MB_ENRICH_PER_IMPORT) {
        enrichMusicBrainzAndSave(dbTrack!.id, track.title, track.artist, artistId);
        enrichmentsQueued++;
      } else {
        enrichmentsDeferred++;
      }
    }

    if (enrichmentsDeferred > 0) {
      console.log(
        `[batch import] queued ${enrichmentsQueued} MusicBrainz enrichments; ` +
          `${enrichmentsDeferred} deferred to first play (1 rps limit)`
      );
    }

    return NextResponse.json({ ok: true, imported: importedIds.length });
  } catch (error) {
    console.error("[Batch Track Import Error]", error);
    return NextResponse.json({ error: "Failed to batch import tracks" }, { status: 500 });
  }
}
