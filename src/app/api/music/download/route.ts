import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { queryOne, query } from "@/lib/sql";
import { enrichTrackMetadata } from "@/lib/metadata";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, artist, duration, albumId: providedAlbumId } = body;

  if (!title || !artist) {
    return NextResponse.json(
      { error: "title and artist are required" },
      { status: 400 }
    );
  }

  try {
    const client = getTelegramClient();
    await client.init();

    const query = `${artist} - ${title}`;
    console.log(`[Telegram AutoDownload] Searching: "${query}"`);

    const { buttonMessageId, buttons } = await client.searchMusic(query, 15000);

    if (buttons.length === 0) {
      return NextResponse.json(
        { error: "No results found on Telegram" },
        { status: 404 }
      );
    }

    console.log(`[Telegram AutoDownload] Got ${buttons.length} results, selecting first: "${buttons[0].text}"`);
    const track = await client.selectResult(buttonMessageId, 0, 30000);

    const userId = session.user.id as string;

    const metadata = await enrichTrackMetadata(track.title, track.artist);

    let artistId: string;
    const existingArtist = await queryOne<{ id: string }>(
      `SELECT id FROM "Artist" WHERE name = $1`,
      [track.artist]
    );

    if (existingArtist) {
      artistId = existingArtist.id;
      if (metadata.artist?.imageUrl) {
        await queryOne(
          `UPDATE "Artist" SET "imageUrl" = COALESCE("imageUrl", $1), "bio" = COALESCE("bio", $2), "deezerId" = COALESCE("deezerId", $3) WHERE id = $4`,
          [metadata.artist.imageUrl, metadata.artist.bio || null, metadata.artist.deezerId || null, artistId]
        );
      }
    } else {
      const newArtist = await queryOne<{ id: string }>(
        `INSERT INTO "Artist" (id, name, "imageUrl", bio, "deezerId", "genres", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [
          metadata.artist?.name || track.artist,
          metadata.artist?.imageUrl || null,
          metadata.artist?.bio || null,
          metadata.artist?.deezerId || null,
          metadata.artist?.genres || [],
        ]
      );
      artistId = newArtist!.id;
    }

    let albumId: string | null = providedAlbumId || null;

    if (!albumId && metadata.album) {
      const existingAlbum = await queryOne<{ id: string }>(
        `SELECT id FROM "Album" WHERE "deezerId" = $1`,
        [metadata.album.deezerId]
      );

      if (existingAlbum) {
        albumId = existingAlbum.id;
      } else {
        let albumArtistId = artistId;
        if (metadata.album.trackList?.length) {
          const firstTrack = metadata.album.trackList[0];
          if (firstTrack.artistName && firstTrack.artistName !== track.artist) {
            const otherArtist = await queryOne<{ id: string }>(
              `SELECT id FROM "Artist" WHERE name = $1`,
              [firstTrack.artistName]
            );
            if (otherArtist) albumArtistId = otherArtist.id;
          }
        }

        const newAlbum = await queryOne<{ id: string }>(
          `INSERT INTO "Album" (id, title, "artistId", "coverUrl", "releaseYear", "releaseDate", genre, "deezerId", copyright, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
           RETURNING id`,
          [
            metadata.album.title,
            albumArtistId,
            metadata.album.coverUrl || null,
            metadata.album.releaseYear || null,
            metadata.album.releaseDate || null,
            metadata.album.genre || null,
            metadata.album.deezerId || null,
            metadata.album.copyright || null,
          ]
        );
        albumId = newAlbum!.id;
      }
    }

    let dbTrack = await queryOne<{ id: string; audioUrl: string }>(
      `SELECT id, "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1`,
      [track.messageId.toString()]
    );

    if (!dbTrack) {
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `INSERT INTO "Track" (id, title, "artistId", "albumId", duration, "audioUrl", source, "telegramMessageId", "deezerId", isrc, "previewUrl", "coverUrl", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'telegram', $6, $7, $8, $9, $10, NOW())
         RETURNING id, "audioUrl"`,
        [
          track.title,
          artistId,
          albumId,
          track.duration || 0,
          `/api/stream/telegram/${track.messageId}`,
          track.messageId.toString(),
          metadata.track?.deezerId || null,
          metadata.track?.isrc || null,
          metadata.track?.previewUrl || null,
          metadata.album?.coverUrl || null,
        ]
      );
    }

    if (metadata.track?.contributors?.length) {
      for (let i = 0; i < metadata.track.contributors.length; i++) {
        const c = metadata.track.contributors[i];
        if (!c.name) continue;

        let contribArtistId: string;
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM "Artist" WHERE name = $1`,
          [c.name]
        );

        if (existing) {
          contribArtistId = existing.id;
          if (c.imageUrl) {
            await queryOne(
              `UPDATE "Artist" SET "imageUrl" = COALESCE("imageUrl", $1) WHERE id = $2 AND "imageUrl" IS NULL`,
              [c.imageUrl, contribArtistId]
            );
          }
        } else {
          const newContrib = await queryOne<{ id: string }>(
            `INSERT INTO "Artist" (id, name, "imageUrl", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, NOW())
             RETURNING id`,
            [c.name, c.imageUrl || null]
          );
          contribArtistId = newContrib!.id;
        }

        const role = c.role === 'Main' ? 'main' : c.role === 'Featured' ? 'featured' : 'contributor';
        await queryOne(
          `INSERT INTO "TrackArtist" ("trackId", "artistId", role, position, "addedAt")
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT ("trackId", "artistId") DO NOTHING`,
          [dbTrack!.id, contribArtistId, role, i]
        );
      }
    } else {
      await queryOne(
        `INSERT INTO "TrackArtist" ("trackId", "artistId", role, position, "addedAt")
         VALUES ($1, $2, 'main', 0, NOW())
         ON CONFLICT ("trackId", "artistId") DO NOTHING`,
        [dbTrack!.id, artistId]
      );
    }

    if (metadata.credits?.length) {
      for (const credit of metadata.credits) {
        await queryOne(
          `INSERT INTO "TrackCredit" ("trackId", name, role, "createdAt")
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT DO NOTHING`,
          [dbTrack!.id, credit.name, credit.role]
        );
      }
    }

    if (metadata.samples?.length) {
      for (const sample of metadata.samples) {
        const existingTrack = await queryOne<{ id: string }>(
          `SELECT id FROM "Track" WHERE title ILIKE $1 LIMIT 1`,
          [`%${sample.trackTitle}%`]
        );

        const sampleTrackId = existingTrack?.id || dbTrack!.id;
        const sampleType = sample.type === "samples" ? "samples" : "sampled";

        await queryOne(
          `INSERT INTO "SampledTrack" ("trackId", "sampledTrackId", "sampleType", "createdAt")
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT DO NOTHING`,
          [dbTrack!.id, sampleTrackId, sampleType]
        );
      }
    }

    return NextResponse.json({
      id: dbTrack!.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      audioUrl: (dbTrack as any).audioUrl,
      messageId: track.messageId,
      albumId,
      coverUrl: metadata.album?.coverUrl || null,
    });
  } catch (error) {
    console.error("[Telegram AutoDownload]", error);
    return NextResponse.json(
      { error: "Failed to download track from Telegram" },
      { status: 500 }
    );
  }
}
