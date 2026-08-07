import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { queryOne, query, execute } from "@/lib/sql";
import { enrichTrackMetadata } from "@/lib/metadata";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This endpoint drives a Telegram bot with a 3-attempt retry and 60s
  // timeouts, so it is by far the most expensive thing a client can trigger.
  // Without a cap, one looping client can saturate the bot for everyone.
  const limited = await rateLimit(
    `download:${session.user.id}`,
    LIMITS.download.limit,
    LIMITS.download.window
  );
  if (!limited.allowed) return rateLimitResponse(limited);

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

    // Named `searchQuery`, not `query` — the imported `query()` helper from
    // lib/sql is used further down, and a local const of the same name shadows
    // it for the whole function body.
    const searchQuery = `${artist} - ${title}`;
    console.log(`[Telegram AutoDownload] Searching: "${searchQuery}"`);

    // searchAndSelect acquires the bot mutex, searches, clicks the first result,
    // waits for audio, then releases — all serialized for reliability
    let track: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        track = await client.searchAndSelect(searchQuery, 0, 35000, 60000);
        break;
      } catch (err) {
        console.warn(`[Telegram AutoDownload] Attempt ${attempt} failed for "${searchQuery}":`, err instanceof Error ? err.message : err);
        lastError = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (!track) {
      throw lastError || new Error("Failed to download track after 3 attempts");
    }

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

    let dbTrack = null;

    if (metadata.track?.deezerId) {
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `SELECT id, "audioUrl" FROM "Track" WHERE "deezerId" = $1`,
        [metadata.track.deezerId.toString()]
      );
    }

    if (!dbTrack) {
      dbTrack = await queryOne<{ id: string; audioUrl: string }>(
        `SELECT id, "audioUrl" FROM "Track" WHERE "telegramMessageId" = $1`,
        [track.messageId.toString()]
      );
    }

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
          metadata.track?.deezerId?.toString() || null,
          metadata.track?.isrc || null,
          metadata.track?.previewUrl || null,
          metadata.album?.coverUrl || null,
        ]
      );
    }

    // ── Contributors ────────────────────────────────────────────────────────
    // Previously this looped one artist at a time with a SELECT then maybe an
    // INSERT per contributor — up to 2N round trips for a track with N credited
    // artists. Now: one upsert for all of them, one read back, one join insert.
    const contributors = metadata.track?.contributors?.filter((c) => c.name) ?? [];

    if (contributors.length > 0) {
      const names = contributors.map((c) => c.name);
      const images = contributors.map((c) => c.imageUrl || null);

      // `ON CONFLICT DO UPDATE` rather than DO NOTHING: DO NOTHING wouldn't
      // return the existing rows, and we need every id back in one trip.
      const artistRows = await query<{ id: string; name: string }>(
        `INSERT INTO "Artist" (id, name, "imageUrl", "createdAt")
         SELECT gen_random_uuid()::text, n, i, NOW()
           FROM UNNEST($1::text[], $2::text[]) AS t(n, i)
         ON CONFLICT (name) DO UPDATE
           SET "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl")
         RETURNING id, name`,
        [names, images]
      );

      const idByName = new Map(artistRows.map((r) => [r.name, r.id]));

      const joinArtistIds: string[] = [];
      const joinRoles: string[] = [];
      const joinPositions: number[] = [];

      contributors.forEach((c, i) => {
        const artistIdForContributor = idByName.get(c.name);
        if (!artistIdForContributor) return;
        joinArtistIds.push(artistIdForContributor);
        joinRoles.push(
          c.role === "Main" ? "main" : c.role === "Featured" ? "featured" : "contributor"
        );
        joinPositions.push(i);
      });

      if (joinArtistIds.length > 0) {
        await execute(
          `INSERT INTO "TrackArtist" ("trackId", "artistId", role, position, "addedAt")
           SELECT $1, a, r, p, NOW()
             FROM UNNEST($2::text[], $3::text[], $4::int[]) AS t(a, r, p)
           ON CONFLICT ("trackId", "artistId") DO NOTHING`,
          [dbTrack!.id, joinArtistIds, joinRoles, joinPositions]
        );
      }
    } else {
      await execute(
        `INSERT INTO "TrackArtist" ("trackId", "artistId", role, position, "addedAt")
         VALUES ($1, $2, 'main', 0, NOW())
         ON CONFLICT ("trackId", "artistId") DO NOTHING`,
        [dbTrack!.id, artistId]
      );
    }

    // ── Credits ─────────────────────────────────────────────────────────────
    // One multi-row insert instead of one per credit. Also de-duplicated: the
    // previous version inserted unconditionally, so re-downloading a track
    // appended a second copy of every producer/writer credit.
    if (metadata.credits?.length) {
      await execute(
        `INSERT INTO "TrackCredit" (id, "trackId", name, role, "createdAt")
         SELECT gen_random_uuid()::text, $1, n, r, NOW()
           FROM UNNEST($2::text[], $3::text[]) AS t(n, r)
          WHERE NOT EXISTS (
            SELECT 1 FROM "TrackCredit" c
             WHERE c."trackId" = $1 AND c.name = t.n AND c.role = t.r
          )`,
        [
          dbTrack!.id,
          metadata.credits.map((c) => c.name),
          metadata.credits.map((c) => c.role),
        ]
      );
    }

    // ── Samples ─────────────────────────────────────────────────────────────
    // The per-sample `SELECT ... WHERE title ILIKE '%x%'` lookup is gone: it
    // ran a full scan per sample, and when it missed it fell back to pointing
    // the sample at the track itself — writing a row claiming the song sampled
    // itself. Resolution now happens in one pass, and unresolvable samples are
    // skipped rather than recorded wrongly.
    if (metadata.samples?.length) {
      const sampleTitles = metadata.samples.map((s) => s.trackTitle);

      const matches = await query<{ id: string; title: string }>(
        `SELECT DISTINCT ON (lower(title)) id, title
           FROM "Track"
          WHERE lower(title) = ANY(SELECT lower(x) FROM UNNEST($1::text[]) AS x)`,
        [sampleTitles]
      ).catch(() => [] as { id: string; title: string }[]);

      const idByTitle = new Map(matches.map((m) => [m.title.toLowerCase(), m.id]));

      const resolved = metadata.samples
        .map((s) => ({
          sampledId: idByTitle.get(s.trackTitle.toLowerCase()),
          type: s.type === "samples" ? "samples" : "sampled",
        }))
        .filter((s): s is { sampledId: string; type: string } =>
          !!s.sampledId && s.sampledId !== dbTrack!.id
        );

      if (resolved.length > 0) {
        await execute(
          `INSERT INTO "SampledTrack" (id, "trackId", "sampledTrackId", "sampleType", "createdAt")
           SELECT gen_random_uuid()::text, $1, s, ty, NOW()
             FROM UNNEST($2::text[], $3::text[]) AS t(s, ty)
           ON CONFLICT DO NOTHING`,
          [dbTrack!.id, resolved.map((r) => r.sampledId), resolved.map((r) => r.type)]
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
