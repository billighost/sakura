import { NextRequest, NextResponse } from "next/server";
import { query, execute } from "@/lib/sql";
import { auth } from "@/lib/auth";
import { findTrackCover } from "@/lib/metadata";
import { cacheDel, cacheKey, bumpNamespace } from "@/lib/cache";

/**
 * POST /api/maintenance/repair-covers
 *
 * Repairs the artwork that earlier imports got wrong.
 *
 * ── The damage this undoes ──────────────────────────────────────────────────
 *
 * Spotify's embed payload carries no per-track artwork for a playlist, and the
 * link resolver used to fall back to the entity's own cover — which for a
 * playlist link is the *playlist's tile*. `/api/playlists/[id]/tracks/batch`
 * then wrote that one image into `Track.coverUrl` for every track in the import,
 * so a 40-song playlist put the same picture on 40 songs, everywhere in the app
 * that reads a track's cover: the queue, the mini player, every track row.
 *
 * The resolvers no longer do that (see lib/importLink.ts and lib/spotify.ts),
 * but rows written before the fix are still wrong, and nothing repairs them on
 * its own: the batch route only ever fills a cover that is `NULL`.
 *
 * ── How a stamped cover is identified ───────────────────────────────────────
 *
 * The broken path left an exact signature. The playlist's own cover was set from
 * `covers[0]` — the first track's cover — which *was* the stamped tile. So a
 * damaged import is a playlist whose `coverUrl` equals the `coverUrl` of several
 * of its own tracks. Three or more is the threshold, since two songs sharing art
 * is an ordinary single-plus-B-side.
 *
 * An album imported as a playlist matches that signature too, and is not
 * actually damaged — its tracks really do share the album's art. Repairing it is
 * harmless: the lookup identifies each track and returns the same album cover it
 * already had. Being wrong in that direction costs one cached provider call;
 * being wrong in the other direction leaves a lie on the screen.
 *
 * Scoped to the caller's own playlists. Idempotent — safe to run twice.
 */

const MAX_TRACKS = 400;
const BATCH = 6;

interface Suspect {
  trackId: string;
  title: string;
  artist: string;
  playlistId: string;
  stampedCover: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  /*
   * Every track whose cover matches its playlist's cover, in a playlist where at
   * least three tracks do. The window function counts within the playlist so a
   * single-track playlist (where cover == track cover legitimately) is excluded
   * by the same predicate.
   */
  const suspects = await query<Suspect>(
    `WITH stamped AS (
       SELECT pt."playlistId",
              t.id    AS "trackId",
              t.title,
              a.name  AS artist,
              t."coverUrl" AS "stampedCover",
              COUNT(*) OVER (PARTITION BY pt."playlistId", t."coverUrl") AS shared
         FROM "Playlist"      p
         JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
         JOIN "Track"         t  ON t.id = pt."trackId"
         LEFT JOIN "Artist"   a  ON a.id = t."artistId"
        WHERE p."userId" = $1
          AND p."coverUrl" IS NOT NULL
          AND t."coverUrl" IS NOT NULL
          AND t."coverUrl" = p."coverUrl"
     )
     SELECT DISTINCT "trackId", title, artist, "playlistId", "stampedCover"
       FROM stamped
      WHERE shared >= 3
      LIMIT $2`,
    [userId, MAX_TRACKS]
  );

  if (suspects.length === 0) {
    return NextResponse.json({ ok: true, examined: 0, repaired: 0, unresolved: 0 });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      examined: suspects.length,
      playlists: [...new Set(suspects.map((s) => s.playlistId))].length,
      sample: suspects.slice(0, 10).map((s) => `${s.artist} — ${s.title}`),
    });
  }

  let repaired = 0;
  let unresolved = 0;
  const touchedPlaylists = new Set<string>();

  for (let i = 0; i < suspects.length; i += BATCH) {
    const batch = suspects.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (s) => {
        const cover = await findTrackCover(s.title, s.artist || "");

        /*
         * A lookup that comes back with the same URL means this wasn't a stamped
         * tile at all — it's genuinely this track's art (the album-as-playlist
         * case). Leave it alone.
         */
        if (cover && cover !== s.stampedCover) {
          await execute(`UPDATE "Track" SET "coverUrl" = $1 WHERE id = $2`, [cover, s.trackId]);
          repaired += 1;
          touchedPlaylists.add(s.playlistId);
          return;
        }

        if (!cover) {
          /*
           * Neither provider could identify it. Clearing the wrong cover is
           * still the right move — a placeholder is honest and the normal
           * enrichment path gets another chance at it later, whereas the stamped
           * tile would sit there forever looking authoritative.
           */
          await execute(`UPDATE "Track" SET "coverUrl" = NULL WHERE id = $1`, [s.trackId]);
          unresolved += 1;
          touchedPlaylists.add(s.playlistId);
        }
      })
    );
  }

  // Playlist reads are cached per playlist, and the library list per user.
  await cacheDel(
    cacheKey("playlists", userId),
    cacheKey("home", userId),
    ...[...touchedPlaylists].map((id) => cacheKey("playlist", id))
  );
  await bumpNamespace("search:entities");

  return NextResponse.json({
    ok: true,
    examined: suspects.length,
    repaired,
    unresolved,
    playlists: touchedPlaylists.size,
    truncated: suspects.length === MAX_TRACKS,
  });
}
