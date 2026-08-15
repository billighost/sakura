import { query, queryOne, softFail } from "@/lib/sql";
import { after } from "next/server";
import { cacheGet, cacheKey, cached, TTL } from "@/lib/cache";
import { updateSystemPlaylist } from "@/lib/charts";
import { pruneListeningHistory } from "@/lib/historyRetention";
import { generateUserMixes } from "@/lib/mixes";
import { getGenreSeedArtists } from "@/lib/catalog";

export type HomeData = {
  user: { name: string; avatarUrl: string | null };
  onboarded: boolean;
  quickPicks: HomeTrack[];
  recentlyPlayed: HomeTrack[];
  topArtists: {
    id: string;
    name: string;
    trackCount: number;
    avatarUrl: string | null;
    /**
     * Where the card goes. Carried explicitly because these artists no longer
     * all live in our database — a provider-sourced one has to open the external
     * browse route, and only the query that produced it knows which it is.
     */
    href: string;
  }[];
  playlists: { id: string; name: string; trackCount: number; coverUrl: string | null }[];
  madeForYou: {
    id: string;
    label: string;
    subtitle: string | null;
    description: string | null;
    coverUrl: string | null;
    coverUrls: string[];
    tint: string;
    kind: string;
    trackCount: number;
  }[];
  systemPlaylists: { id: string; systemId: string; name: string; coverUrl: string | null }[];
};

/**
 * `audioUrl` and `duration` are carried through so a home card can start
 * playback where it stands. Without them the cards could only link to a detail
 * page, which is two taps and a page load to hear a track the rail is
 * explicitly recommending.
 */
export type HomeTrack = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  audioUrl: string | null;
  duration: number;
};

/**
 * Charts refresh at most once a day.
 *
 * Scheduled with `after()` rather than `setTimeout`: a timer fired during a
 * server render is not guaranteed to survive the response — on a serverless
 * host the function can be frozen the moment the response flushes, so the
 * work silently never runs. `after()` is the supported way to say "do this
 * once the response is done" and keeps the runtime alive for it.
 */
function scheduleDailyChartUpdate() {
  after(async () => {
    try {
      await updateSystemPlaylist("top-50-global", "Top 50 Global", "global");
      await updateSystemPlaylist("top-50-country", "Top 50 in your Country", "country");
      await updateSystemPlaylist("top-50-nigeria", "Top 50 Nigeria", "nigeria");
      await updateSystemPlaylist("top-50-africa", "Top 50 Africa", "africa");
      await updateSystemPlaylist("top-50-community", "Sakura Global Top 50", "community");
    } catch (e) {
      console.error("[HomeData] Failed to update system playlists:", e);
    }

    /**
     * Fold aged-out listening history on the same daily cadence.
     *
     * ListeningHistory is the only table that grows with time rather than with
     * catalogue or userbase — ~290MB/month at 1000 users against a 500MB
     * budget — so something has to bound it, and this is already the one job
     * that runs once a day behind a lock. It is guarded separately from the
     * chart work above so a provider outage doesn't also stop the pruning.
     */
    try {
      await pruneListeningHistory();
    } catch (e) {
      console.error("[HomeData] History prune failed:", e);
    }
  });
}

export async function getHomeData(userId: string): Promise<HomeData> {
  const key = cacheKey("home", userId);
  const hit = await cacheGet<HomeData>(key);
  if (hit) return hit;

  /**
   * Everything below is the cache-miss path, and it costs eleven Postgres
   * round trips. Running it under `cached` rather than open-coding
   * get-then-set is what stops a popular expiry from becoming a stampede: when
   * an entry lapses and thirty requests for the same user arrive together — a
   * reload, a service worker sync, several open tabs — only the first rebuilds
   * and the rest wait on it. Open-coded, all thirty would run all eleven
   * queries.
   */
  return cached(key, TTL.HOME, async () => {
    // Check whether system playlists need updating. Awaited rather than
    // floated: the check is a single indexed lookup, and a dangling promise
    // during a server render is exactly the pattern that made the old
    // setTimeout version unreliable.
    try {
      const globalPl = await queryOne<{ updatedAt: Date }>(
        `SELECT "updatedAt" FROM "SystemPlaylist" WHERE "systemId" = 'top-50-global'`
      );
      if (!globalPl || Date.now() - new Date(globalPl.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
        scheduleDailyChartUpdate();
      }
    } catch (e) {
      console.error("[HomeData] Chart freshness check failed:", e);
      scheduleDailyChartUpdate();
    }

    return buildHomeData(userId);
  });
}

async function buildHomeData(userId: string): Promise<HomeData> {
  const [user, taste, quickPicks, recentlyPlayed, topArtists, playlists, mixes, systemPlaylists] =
    await Promise.all([
      // 1. User info
      queryOne<{ name: string; avatarUrl: string | null }>(
        `SELECT username AS name, "avatarUrl" FROM "User" WHERE id = $1`,
        [userId]
      ),

      // 2. Onboarding state — drives the "build your taste" prompt. The genres
      //    come along for the ride because the top-artists rail needs them when
      //    the user has no listening history yet.
      queryOne<{ onboarded: boolean; topGenres: string[] | null; seedGenres: string[] | null }>(
        `SELECT onboarded, "topGenres", "seedGenres" FROM "TasteProfile" WHERE "userId" = $1`,
        [userId]
      ).catch(softFail("home:onboarded", null)),

      // 3. Quick Picks — favourites and heavy rotation, newest signal first.
      //    Falls back to popular catalogue tracks for a user with no history.
      query<HomeTrack>(
        `SELECT t.id, t.title, a.name AS artist, t."audioUrl", t.duration,
                COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl"
         FROM "Track" t
         LEFT JOIN "Artist" a ON a.id = t."artistId"
         LEFT JOIN "Album"  al ON al.id = t."albumId"
         WHERE t.id IN (
           SELECT DISTINCT "trackId" FROM "ListeningHistory"
           WHERE "userId" = $1 AND "playedAt" > NOW() - INTERVAL '30 days'
           UNION
           SELECT "trackId" FROM "Favorite" WHERE "userId" = $1
         )
         AND t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
         ORDER BY RANDOM()
         LIMIT 6`,
        [userId]
      )
        .then(async (tracks) => {
          if (tracks.length > 0) return tracks;
          return query<HomeTrack>(
            `SELECT t.id, t.title, a.name AS artist, t."audioUrl", t.duration,
                    COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl"
             FROM "Track" t
             LEFT JOIN "Artist" a ON a.id = t."artistId"
             LEFT JOIN "Album"  al ON al.id = t."albumId"
             WHERE t."audioUrl" IS NOT NULL AND t."audioUrl" <> '' AND t."audioUrl" <> 'pending'
             ORDER BY RANDOM()
             LIMIT 6`
          );
        })
        .catch(softFail("home:quickPicks", [])),

      // 4. Recently played
      query<HomeTrack>(
        `SELECT DISTINCT ON (h."trackId")
           t.id, t.title, a.name AS artist, t."audioUrl", t.duration,
           COALESCE(t."coverUrl", al."coverUrl") AS "coverUrl"
         FROM "ListeningHistory" h
         JOIN  "Track"  t  ON t.id  = h."trackId"
         LEFT JOIN "Artist" a  ON a.id  = t."artistId"
         LEFT JOIN "Album"  al ON al.id = t."albumId"
         WHERE h."userId" = $1
         ORDER BY h."trackId", h."playedAt" DESC
         LIMIT 12`,
        [userId]
      ).catch(softFail("home:recentlyPlayed", [])),

      // 5. Top artists — driven by affinity score rather than a raw play count,
      //    so an artist someone skips constantly stops ranking highly. The
      //    cold-start case is handled after this block, where the taste genres
      //    are available.
      query<{ id: string; name: string; trackCount: number; avatarUrl: string | null }>(
        `SELECT a.id, a.name, a."imageUrl" AS "avatarUrl", aff.plays AS "trackCount"
         FROM "ArtistAffinity" aff
         JOIN "Artist" a ON a.id = aff."artistId"
         WHERE aff."userId" = $1 AND aff.score > 0
         ORDER BY aff.score DESC
         LIMIT 8`,
        [userId]
      ).catch(softFail("home:topArtists", [])),

      // 6. User playlists
      query<{ id: string; name: string; trackCount: number; coverUrl: string | null }>(
        `SELECT p.id, p.name, p."coverUrl",
                COUNT(pt."trackId")::int AS "trackCount"
         FROM "Playlist" p
         LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
         WHERE p."userId" = $1
         GROUP BY p.id, p.name, p."coverUrl"
         ORDER BY p."createdAt" DESC
         LIMIT 4`,
        [userId]
      ).catch(softFail("home:playlists", [])),

      // 7. Active mixes
      query<{
        id: string;
        label: string;
        subtitle: string | null;
        description: string | null;
        coverUrl: string | null;
        coverUrls: string[];
        tint: string;
        kind: string;
        trackCount: number;
      }>(
        `SELECT id, label, subtitle, description, "coverUrl", "coverUrls", tint, kind,
                COALESCE(array_length("trackIds", 1), 0) AS "trackCount"
         FROM "UserMix"
         WHERE "userId" = $1 AND "expiresAt" > NOW()
         ORDER BY
           CASE kind
             WHEN 'daily'     THEN 1
             WHEN 'repeat'    THEN 2
             WHEN 'discover'  THEN 3
             WHEN 'timeofday' THEN 4
             WHEN 'deepcuts'  THEN 5
             WHEN 'throwback' THEN 6
             ELSE 7
           END,
           slot ASC
         LIMIT 8`,
        [userId]
      ).catch(softFail("home:mixes", [])),

      // 8. System Playlists (Top 50s)
      query<{ id: string; systemId: string; name: string; coverUrl: string | null }>(
        `SELECT id, "systemId", name, "coverUrl"
         FROM "SystemPlaylist"
         ORDER BY "name" ASC`
      ).catch(softFail("home:systemPlaylists", [])),
    ]);

  /*
   * Cold start for the artist rail.
   *
   * Someone with no affinity rows yet used to get "the artists we happen to hold
   * the most tracks for" — a list about our download history, not about them,
   * and on a young catalogue a near-random one. Ask the provider for artists in
   * the genres they actually chose instead.
   *
   * Runs after the batch above rather than inside it because it needs the taste
   * genres, and it only runs at all on the cold path, which by definition has
   * nothing else to show. A user who skipped onboarding has no genres, so the
   * rail stays empty and hides itself — better than a list of strangers.
   */
  let artistRail: HomeData["topArtists"] = topArtists.map((a) => ({
    ...a,
    href: `/artist/${a.id}`,
  }));

  if (artistRail.length === 0) {
    const genres = [...(taste?.topGenres ?? []), ...(taste?.seedGenres ?? [])]
      .filter(Boolean)
      .slice(0, 3);

    if (genres.length > 0) {
      const lists = await Promise.all(
        genres.map((g) => getGenreSeedArtists(g, 6).catch(() => []))
      );

      // Interleaved so each chosen genre is represented, then deduped.
      const seen = new Set<number>();
      const picked: HomeData["topArtists"] = [];
      const depth = Math.max(...lists.map((l) => l.length), 0);

      for (let i = 0; i < depth && picked.length < 8; i++) {
        for (const list of lists) {
          if (picked.length >= 8) break;
          const a = list[i];
          if (!a?.id || !a.name || seen.has(a.id)) continue;
          seen.add(a.id);
          picked.push({
            id: `deezer-${a.id}`,
            name: a.name,
            trackCount: 0,
            avatarUrl: a.picture_medium ?? a.picture_big ?? null,
            // The external browse route, not `/artist/<id>` — there is no row.
            href: `/browse/artist/${a.id}`,
          });
        }
      }

      artistRail = picked;
    }
  }

  const result: HomeData = {
    user: user ?? { name: "Listener", avatarUrl: null },
    onboarded: taste?.onboarded ?? false,
    quickPicks,
    recentlyPlayed,
    topArtists: artistRail,
    playlists: playlists.map(p => {
      let coverUrl = p.coverUrl;
      if (coverUrl?.startsWith('[')) {
        try {
          const parsed = JSON.parse(coverUrl);
          coverUrl = parsed?.[0] || null;
        } catch {}
      }
      return { ...p, coverUrl };
    }),
    madeForYou: mixes,
    systemPlaylists,
  };

  // No live mixes means they've expired or were never built. Regenerate after
  // the response so the *next* load has them — a full generation pass costs
  // seconds and must not block this render.
  if (mixes.length === 0) {
    after(async () => {
      try {
        await generateUserMixes(userId);
      } catch (e) {
        console.error("[HomeData] Failed to generate user mixes:", e);
      }
    });
  }

  // Storing is `cached`'s job now — doing it here as well would write the entry
  // twice on every miss, which on a metered Redis is a doubled bill for nothing.
  return result;
}
