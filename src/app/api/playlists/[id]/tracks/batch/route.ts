import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { enrichMusicBrainzAndSave } from "@/lib/metadata";
import { getDeterministicTrackId } from "@/lib/deterministic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { tracks } = await req.json();

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return NextResponse.json({ error: "Invalid tracks array" }, { status: 400 });
  }

  const playlist = await queryOne(
    `SELECT id, "coverUrl" FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, session.user.id!]
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    let maxRow = await queryOne<{ maxPos: number | null }>(
      `SELECT MAX(position) as "maxPos" FROM "PlaylistTrack" WHERE "playlistId" = $1`,
      [id]
    );
    let pos = (maxRow?.maxPos ?? -1) + 1;

    // Process all tracks
    const importedIds = [];
    
    // Set the playlist cover URL to a JSON array of the first 4 track covers (if it doesn't have a cover yet)
    // The frontend will parse this JSON array to render a 2x2 collage!
    if (!playlist.coverUrl) {
      const covers = tracks.map(t => t.coverUrl).filter(Boolean).slice(0, 4);
      if (covers.length > 0) {
        // If it's only 1 cover, just store the string. If multiple, store JSON array.
        const coverStr = covers.length === 1 ? covers[0] : JSON.stringify(covers);
        await execute(`UPDATE "Playlist" SET "coverUrl" = $1 WHERE id = $2`, [coverStr, id]);
      }
    }

    for (const track of tracks) {
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

      // Trigger background MusicBrainz metadata fetch
      enrichMusicBrainzAndSave(dbTrack!.id, track.title, track.artist, artistId);
    }

    return NextResponse.json({ ok: true, imported: importedIds.length });
  } catch (error) {
    console.error("[Batch Track Import Error]", error);
    return NextResponse.json({ error: "Failed to batch import tracks" }, { status: 500 });
  }
}
