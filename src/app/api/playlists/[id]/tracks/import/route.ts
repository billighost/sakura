import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { enrichTrackMetadata, enrichMusicBrainzAndSave } from "@/lib/metadata";
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
  const { telegramMetadata } = await req.json();

  if (!telegramMetadata || !telegramMetadata.title || !telegramMetadata.artist || !telegramMetadata.messageId) {
    return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
  }

  const playlist = await queryOne(
    `SELECT id FROM "Playlist" WHERE id = $1 AND "userId" = $2`,
    [id, session.user.id!]
  );

  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  try {
    const track = telegramMetadata;
    const metadata = await enrichTrackMetadata(track.title, track.artist);

    const artistId = (await queryOne<{ id: string }>(
      `INSERT INTO "Artist" (id, name, "imageUrl", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl")
       RETURNING id`,
      [track.artist, metadata.artist?.imageUrl || null]
    ))!.id;

    // Get or Create Album (simplified for playlist import)
    let albumId: string | null = null;
    if (metadata.album) {
      const existingAlbum = await queryOne<{ id: string }>(
        `SELECT id FROM "Album" WHERE "deezerId" = $1 OR title = $2 LIMIT 1`,
        [metadata.album.deezerId || 'none', metadata.album.title]
      );
      if (existingAlbum) {
        albumId = existingAlbum.id;
      } else {
        const newAlbum = await queryOne<{ id: string }>(
          `INSERT INTO "Album" (id, title, "artistId", "coverUrl", "releaseYear", "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
           RETURNING id`,
          [
            metadata.album.title,
            artistId,
            metadata.album.coverUrl || null,
            metadata.album.releaseYear || null,
          ]
        );
        albumId = newAlbum!.id;
      }
    }

    // Get or Create Track by deterministic ID
    const trackId = getDeterministicTrackId(track.title, track.artist);
    let dbTrack = await queryOne<{ id: string }>(
      `SELECT id FROM "Track" WHERE id = $1 OR "telegramMessageId" = $2 LIMIT 1`,
      [trackId, track.messageId.toString()]
    );

    if (!dbTrack) {
      dbTrack = await queryOne<{ id: string }>(
        `INSERT INTO "Track" (id, title, "artistId", "albumId", duration, "audioUrl", source, "telegramMessageId", "coverUrl", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'telegram', $7, $8, NOW())
         RETURNING id`,
        [
          trackId,
          track.title,
          artistId,
          albumId,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
          metadata.album?.coverUrl || null,
        ]
      );
    } else {
      // If it exists, update the telegramMessageId and audioUrl if they were missing/stubbed
      await execute(
        `UPDATE "Track" 
         SET "audioUrl" = COALESCE(NULLIF("audioUrl", 'pending'), $1),
             "telegramMessageId" = COALESCE(NULLIF("telegramMessageId", '0'), $2)
         WHERE id = $3`,
        [`/api/stream/telegram/${track.messageId}`, track.messageId.toString(), dbTrack.id]
      );
    }

    // Insert into PlaylistTrack
    const maxRow = await queryOne<{ maxPos: number | null }>(
      `SELECT MAX(position) as "maxPos" FROM "PlaylistTrack" WHERE "playlistId" = $1`,
      [id]
    );

    const pos = (maxRow?.maxPos ?? -1) + 1;

    await execute(
      `INSERT INTO "PlaylistTrack" ("playlistId", "trackId", position) VALUES ($1, $2, $3)
       ON CONFLICT ("playlistId", "trackId") DO NOTHING`,
      [id, dbTrack!.id, pos]
    );

    // Trigger MusicBrainz enrichment in the background so it does not block the response
    enrichMusicBrainzAndSave(dbTrack!.id, track.title, track.artist, artistId);

    return NextResponse.json({ ok: true, trackId: dbTrack!.id });
  } catch (error) {
    console.error("[Playlist Track Import Error]", error);
    return NextResponse.json({ error: "Failed to import track" }, { status: 500 });
  }
}
