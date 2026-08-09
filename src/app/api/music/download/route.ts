import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramClientForBot, getBotFallbackChain } from "@/lib/telegram";
import { queryOne, query, execute } from "@/lib/sql";
import { enrichTrackMetadata, enrichMusicBrainzAndSave, searchDeezerTrack } from "@/lib/metadata";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import { cacheGet, cacheSet } from "@/lib/cache";
import { Redis } from "@upstash/redis";

// Telegram search + download can take up to ~2 minutes with retries.
// Without this Vercel kills the function at 10s (default) with no status code.
export const maxDuration = 300;

/**
 * How long a "requested title → stored track id" alias lives.
 *
 * Long, because it records a fact that doesn't change: the song Telegram
 * returned for a given search phrase. Anything shorter re-opens the window
 * where a differently-titled match costs a fresh bot download.
 */
const ALIAS_TTL_SECONDS = 30 * 24 * 60 * 60;

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

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
  const requestKey = `${artist.toLowerCase().trim()} - ${title.toLowerCase().trim()}`;
  const aliasKey = `dl:alias:${requestKey}`;

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
      const isAudioUsable = au.startsWith("/api/stream/telegram/") && !au.endsWith("/0");

      if (isAudioUsable) {
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

    /**
     * Second chance: the same song under a different canonical title.
     */
    const aliasId = await cacheGet<string>(aliasKey);
    if (aliasId) {
      const aliased = await queryOne<{
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
         WHERE t.id = $1`,
        [aliasId]
      );
      const aliasUrl = aliased?.audioUrl || "";
      if (aliased && aliasUrl.startsWith("/api/stream/telegram/") && !aliasUrl.endsWith("/0")) {
        console.log(`[Telegram AutoDownload] Alias hit for "${artist} - ${title}" → "${aliased.title}".`);
        return NextResponse.json({
          id: aliased.id,
          title: aliased.title,
          artist: aliased.artistName,
          duration: aliased.duration,
          audioUrl: aliased.audioUrl,
          messageId: aliased.telegramMessageId ? parseInt(aliased.telegramMessageId, 10) : null,
          albumId: aliased.albumId,
          coverUrl: aliased.coverUrl,
        });
      }
    }
  } catch (err) {
    console.error("[Telegram AutoDownload] Pre-lookup database error:", err);
  }

  // This endpoint drives a Telegram bot with a 3-attempt retry and 60s
  // timeouts, so it is by far the most expensive thing a client can trigger.
  const limited = await rateLimit(
    `download:${session.user.id}`,
    LIMITS.download.limit,
    LIMITS.download.window
  );
  if (!limited.allowed) return rateLimitResponse(limited);

  const cacheKey = requestKey;
  const searchQuery = `${artist} - ${title}`;
  const negativeCacheKey = `download:failed:${cacheKey}`;

  if (redis) {
    const isFailed = await redis.get(negativeCacheKey);
    if (isFailed) {
      return NextResponse.json(
        { error: "Track currently unavailable (cached failure)" },
        { status: 404 }
      );
    }
  }

  if (pendingDownloads.has(cacheKey)) {
    console.log(`[Telegram AutoDownload] Coalescing request for "${searchQuery}". Waiting for active download...`);
    try {
      const shared = await pendingDownloads.get(cacheKey);
      if (shared) {
        return NextResponse.json(shared);
      }

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
  const downloadPromise = new Promise<any>((resolve, reject) => {
    resolveDownload = resolve;
    rejectDownload = reject;
  });
  // Prevent unhandledRejection if the promise rejects while no coalesced request is awaiting it.
  downloadPromise.catch(() => {});
  pendingDownloads.set(cacheKey, downloadPromise);

  try {
    console.log(`[Telegram AutoDownload] Searching: "${searchQuery}"`);

    // Await Deezer track lookup first. We prefer Deezer URLs because they bypass
    // the bot's daily text-search rate limits and are usually more accurate.
    const deezerTrack = await searchDeezerTrack(title, artist).catch(() => null);
    const deezerUrl = deezerTrack?.id ? `https://www.deezer.com/track/${deezerTrack.id}` : null;

    // Try each bot in the fallback chain.
    let track: any = null;
    let lastError: any = null;
    const botChain = getBotFallbackChain();

    for (const botUsername of botChain) {
      const botClient = getTelegramClientForBot(botUsername);
      await botClient.acquire();
      try {
        const queriesToTry = deezerUrl ? [deezerUrl, searchQuery] : [searchQuery];
        
        for (const query of queriesToTry) {
          const isUrl = query.startsWith("http");
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              console.log(`[Telegram AutoDownload] Trying bot "${botUsername}" for "${query}" (attempt ${attempt})`);
              track = await botClient.searchAndSelect(query, duration ? Number(duration) : undefined, 25000, 45000);
              break;
            } catch (err: any) {
              const msg = String(err?.message || "");
              const isRateLimited = msg.includes("rate-limited") || msg.includes("limit reached") || msg.includes("daily");
              const isNotFound = msg.includes("not found") || msg.includes("Bot responded:");
              
              console.warn(`[Telegram AutoDownload] Bot "${botUsername}" attempt ${attempt} failed for "${query}":`, msg);
              lastError = err;
              
              if (isRateLimited) {
                // If text search is rate-limited and we have a Deezer URL we didn't try (shouldn't happen with the new order, but just in case),
                // we break the current query loop.
                break;
              }
              
              if (isNotFound && isUrl) {
                // If Deezer URL wasn't found by the bot, break attempt loop to fallback to text search immediately
                break;
              }

              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 1500));
              }
            }
          }
          if (track) break; // success, break query loop
          
          // If we got rate-limited on the current query, and it was a text search, skip to next bot.
          // Or if it was a URL and got rate limited (unlikely), also skip to next bot.
          const msg = String(lastError?.message || "");
          if (msg.includes("rate-limited") || msg.includes("limit reached") || msg.includes("daily")) {
            break; // breaks query loop, proceeds to throw below and catch skips to next bot
          }
        }
        if (track) break; // success, break bot loop
        
        // If we exhausted all queries for this bot and still no track, throw the last error
        // to either propagate it or trigger the next bot in the chain.
        throw lastError;
      } catch (err: any) {
        const msg = String(err?.message || "");
        const isRateLimited = msg.includes("rate-limited") || msg.includes("limit reached") || msg.includes("daily");
        if (isRateLimited) {
          console.warn(`[Telegram AutoDownload] Bot "${botUsername}" exhausted. Trying next fallback bot...`);
          lastError = err;
          continue; // try next bot
        }
        throw err; // non-rate-limit error: propagate immediately
      } finally {
        await botClient.release();
      }
    }

    if (!track) {
      throw lastError || new Error("All bots failed or are rate-limited");
    }

    const userId = session.user.id as string;

    const metadata = await enrichTrackMetadata(track.title, track.artist);

    const artistId = (await queryOne<{ id: string }>(
      `INSERT INTO "Artist" (id, name, "imageUrl", bio, "deezerId", "genres", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (name) DO UPDATE SET
         "imageUrl" = COALESCE("Artist"."imageUrl", EXCLUDED."imageUrl"),
         bio = COALESCE("Artist".bio, EXCLUDED.bio),
         "deezerId" = COALESCE("Artist"."deezerId", EXCLUDED."deezerId")
       RETURNING id`,
      [
        track.artist,
        metadata.artist?.imageUrl || null,
        metadata.artist?.bio || null,
        metadata.artist?.deezerId || null,
        metadata.artist?.genres || [],
      ]
    ))!.id;

    let albumId: string | null = providedAlbumId || null;

    if (metadata.album) {
      const existingAlbum = await queryOne<{ id: string }>(
        `SELECT id FROM "Album" WHERE "deezerId" = $1 OR id = $2`,
        [metadata.album.deezerId, albumId]
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
    } else if (albumId && albumId.startsWith("deezer-")) {
      albumId = null;
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

    if (dbTrack) {
      const newAudioUrl = `/api/stream/telegram/${track.messageId}`;
      await execute(
        `UPDATE "Track" 
         SET "audioUrl" = $1, "telegramMessageId" = $2, duration = GREATEST(duration, $3), "source" = 'telegram'
         WHERE id = $4`,
        [newAudioUrl, track.messageId.toString(), track.duration || 0, dbTrack.id]
      );
      (dbTrack as any).audioUrl = newAudioUrl;
    } else {
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
        const isDuplicate =
          insertErr?.code === "23505" ||
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
    const contributors = metadata.track?.contributors?.filter((c) => c.name) ?? [];

    if (contributors.length > 0) {
      const names = contributors.map((c) => c.name);
      const images = contributors.map((c) => c.imageUrl || null);

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

    // Trigger MusicBrainz enrichment in the background
    enrichMusicBrainzAndSave(dbTrack!.id, track.title, track.artist, artistId);

    // Migrate favorite from deezer- virtual track to real track
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

    const payload = {
      id: dbTrack!.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      audioUrl: (dbTrack as any).audioUrl,
      messageId: track.messageId,
      albumId,
      coverUrl: metadata.album?.coverUrl || null,
    };

    await cacheSet(aliasKey, dbTrack!.id, ALIAS_TTL_SECONDS).catch(() => {});

    resolveDownload(payload);
    pendingDownloads.delete(cacheKey);

    return NextResponse.json(payload);
  } catch (error: any) {
    rejectDownload(error);
    pendingDownloads.delete(cacheKey);
    console.error("[Telegram AutoDownload]", error);

    const msg = String(error?.message || "");
    const isRateLimited = msg.includes("rate-limited") || msg.includes("limit reached") || msg.includes("daily");
    const isNoResults = msg.includes("Bot responded:") || msg.includes("No results found");

    // Don't negative-cache rate limits — the bot will work again tomorrow.
    if (redis && !isRateLimited) {
      await redis.set(negativeCacheKey, "1", { ex: 30 }).catch(console.error);
    }

    if (isRateLimited) {
      return NextResponse.json(
        { error: "The music bot has reached its daily search limit. Please try again tomorrow." },
        { status: 429 }
      );
    }

    if (isNoResults) {
      return NextResponse.json(
        { error: "Track not found on Telegram bot" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Failed to download track from Telegram" },
      { status: 500 }
    );
  }
}
