import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClient } from "@/lib/telegram";
import { queryOne, query, execute } from "@/lib/sql";
import { enrichTrackMetadata, enrichMusicBrainzAndSave } from "@/lib/metadata";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";

const globalForPendingDownloads = globalThis as unknown as {
  pendingDownloads?: Map<string, Promise<any>>;
};

if (!globalForPendingDownloads.pendingDownloads) {
  globalForPendingDownloads.pendingDownloads = new Map();
}
const pendingDownloads = globalForPendingDownloads.pendingDownloads;

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

  // 1. Try to find the track in our database first to avoid hitting Telegram
  try {
    const existingTrack = await queryOne<{
      id: string;
      title: string;
      artistName: string;
      duration: number;
      audioUrl: string | null;
      albumId: string | null;
      coverUrl: string | null;
      telegramMessageId: string | null;
    }>(
      `SELECT t.id, t.title, a.name as "artistName", t.duration, t."audioUrl", t."albumId", t."coverUrl", t."telegramMessageId"
       FROM "Track" t
       JOIN "Artist" a ON t."artistId" = a.id
       WHERE lower(t.title) = lower($1) AND lower(a.name) = lower($2)`,
      [title, artist]
    );

    if (existingTrack) {
      /**
       * Guard against returning a useless audioUrl:
       *  - null/empty  → track was inserted as a Deezer stub with no audio
       *  - dzcdn.net   → Deezer 30-second preview; not a real audio stream
       *  - /api/stream/telegram/0 → broken telegram stream (messageId=0)
       * In all these cases fall through to Telegram to get a real file.
       */
      const au = existingTrack.audioUrl || "";
      const audioUrlUnusable =
        !au ||
        au.includes("dzcdn.net") ||
        au.endsWith("/api/stream/telegram/0") ||
        au === "/api/stream/telegram/0";

      if (!audioUrlUnusable) {
        console.log(`[Telegram AutoDownload] Cache hit for "${artist} - ${title}". Returning DB track.`);
        return NextResponse.json({
          id: existingTrack.id,
          title: existingTrack.title,
          artist: existingTrack.artistName,
          duration: existingTrack.duration,
          audioUrl: existingTrack.audioUrl,
          messageId: existingTrack.telegramMessageId ? parseInt(existingTrack.telegramMessageId, 10) : null,
          albumId: existingTrack.albumId,
          coverUrl: existingTrack.coverUrl,
        });
      }

      console.log(`[Telegram AutoDownload] Cache hit for "${artist} - ${title}" but audioUrl is unusable ("${au}"). Re-downloading from Telegram.`);
    }
  } catch (err) {
    console.error("[Telegram AutoDownload] Pre-lookup database error:", err);
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

  const cacheKey = `${artist.toLowerCase().trim()} - ${title.toLowerCase().trim()}`;
  const searchQuery = `${artist} - ${title}`;

  if (pendingDownloads.has(cacheKey)) {
    console.log(`[Telegram AutoDownload] Coalescing request for "${searchQuery}". Waiting for active download...`);
    try {
      await pendingDownloads.get(cacheKey);
      // Retrieve the newly created track
      const newTrack = await queryOne<{
        id: string;
        title: string;
        artistName: string;
        duration: number;
        audioUrl: string;
        albumId: string | null;
        coverUrl: string | null;
        telegramMessageId: string | null;
      }>(
        `SELECT t.id, t.title, a.name as "artistName", t.duration, t."audioUrl", t."albumId", t."coverUrl", t."telegramMessageId"
         FROM "Track" t
         JOIN "Artist" a ON t."artistId" = a.id
         WHERE lower(t.title) = lower($1) AND lower(a.name) = lower($2)`,
        [title, artist]
      );
      if (newTrack) {
        return NextResponse.json({
          id: newTrack.id,
          title: newTrack.title,
          artist: newTrack.artistName,
          duration: newTrack.duration,
          audioUrl: newTrack.audioUrl,
          messageId: newTrack.telegramMessageId ? parseInt(newTrack.telegramMessageId, 10) : null,
          albumId: newTrack.albumId,
          coverUrl: newTrack.coverUrl,
        });
      }
    } catch (err) {
      console.error(`[Telegram AutoDownload] Coalesced request failed for "${searchQuery}":`, err);
      return NextResponse.json(
        { error: "Failed to download track from Telegram" },
        { status: 500 }
      );
    }
  }

  // If we get here, we are the first downloader. Register the promise wrapper:
  let resolveDownload: (value?: any) => void = () => {};
  let rejectDownload: (reason?: any) => void = () => {};
  const downloadPromise = new Promise((resolve, reject) => {
    resolveDownload = resolve;
    rejectDownload = reject;
  });
  pendingDownloads.set(cacheKey, downloadPromise);

  try {
    const client = getTelegramClient();
    await client.init();

    console.log(`[Telegram AutoDownload] Searching: "${searchQuery}"`);

    // searchAndSelect acquires the bot mutex, searches, clicks the first result,
    // waits for audio, then releases — all serialized for reliability
    let track: any = null;
    let lastError: any = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        track = await client.searchAndSelect(searchQuery, duration ? Number(duration) : undefined, 20000, 35000);
        break;
      } catch (err) {
        console.warn(`[Telegram AutoDownload] Attempt ${attempt} failed for "${searchQuery}":`, err instanceof Error ? err.message : err);
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500));
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
      // Two concurrent serverless instances may both pass the earlier lookups
      // and try to insert the same track simultaneously. Wrap in try/catch so
      // the loser of the race falls back to selecting the winner's row.
      try {
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
      } catch (insertErr: any) {
        // If the insert failed due to a concurrent duplicate, find the existing row.
        const isDuplicate =
          insertErr?.code === "23505" || // PostgreSQL unique_violation
          String(insertErr?.message).includes("duplicate key");

        if (isDuplicate) {
          console.warn("[Telegram AutoDownload] Concurrent insert race detected, selecting existing row");
          dbTrack = await queryOne<{ id: string; audioUrl: string }>(
            `SELECT id, "audioUrl" FROM "Track"
              WHERE "telegramMessageId" = $1
                 OR (lower(title) = lower($2) AND "artistId" = $3)
              LIMIT 1`,
            [track.messageId.toString(), track.title, artistId]
          );
        }
        if (!dbTrack) throw insertErr;
      }
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

    // Trigger MusicBrainz enrichment in the background so it does not block the response
    enrichMusicBrainzAndSave(dbTrack!.id, track.title, track.artist, artistId);

    // If the user had already liked the virtual deezer- version of this track
    // (e.g. liked before ever playing it), migrate that Favorite row to the
    // new real track id so the heart icon stays filled after the download.
    if (metadata.track?.deezerId) {
      const deezerId = metadata.track.deezerId.toString();
      const deezerTrackId = `deezer-${deezerId}`;
      execute(
        `UPDATE "Favorite" SET "trackId" = $1
          WHERE "trackId" = $2
            AND NOT EXISTS (
              SELECT 1 FROM "Favorite" WHERE "trackId" = $1 AND "userId" = "Favorite"."userId"
            )`,
        [dbTrack!.id, deezerTrackId]
      ).catch((err) => console.warn("[Telegram AutoDownload] Favorite migration failed:", err));
    }

    resolveDownload();
    pendingDownloads.delete(cacheKey);

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
    rejectDownload(error);
    pendingDownloads.delete(cacheKey);
    console.error("[Telegram AutoDownload]", error);
    return NextResponse.json(
      { error: "Failed to download track from Telegram" },
      { status: 500 }
    );
  }
}
