import { NextResponse } from "next/server";
import { query } from "@/lib/sql";
import { auth } from "@/lib/auth";

/**
 * GET /api/export
 *
 * Streams a JSON file containing all the user's data:
 *  - Profile info
 *  - Listening history (last 5 000 entries)
 *  - Favourited tracks
 *  - Playlists + their tracks
 *
 * The response is sent as an attachment so the browser downloads it.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id!;

  const [profile, history, favourites, playlists] = await Promise.all([
    query(
      `SELECT username, email, bio, "avatarUrl", "createdAt" FROM "User" WHERE id = $1`,
      [userId]
    ),
    query(
      `SELECT t.title, a.name AS artist, al.title AS album, h."playedAt"
       FROM "ListeningHistory" h
       JOIN  "Track"  t  ON t.id  = h."trackId"
       LEFT JOIN "Artist" a  ON a.id  = t."artistId"
       LEFT JOIN "Album"  al ON al.id = t."albumId"
       WHERE h."userId" = $1
       ORDER BY h."playedAt" DESC
       LIMIT 5000`,
      [userId]
    ),
    query(
      `SELECT t.title, a.name AS artist, al.title AS album, f."createdAt" AS "likedAt"
       FROM "Favorite" f
       JOIN  "Track"  t  ON t.id  = f."trackId"
       LEFT JOIN "Artist" a  ON a.id  = t."artistId"
       LEFT JOIN "Album"  al ON al.id = t."albumId"
       WHERE f."userId" = $1
       ORDER BY f."createdAt" DESC`,
      [userId]
    ),
    query(
      `SELECT p.name AS playlist, p.description, p."createdAt",
              json_agg(
                json_build_object(
                  'title', t.title,
                  'artist', a.name,
                  'position', pt.position
                ) ORDER BY pt.position
              ) AS tracks
       FROM "Playlist" p
       LEFT JOIN "PlaylistTrack" pt ON pt."playlistId" = p.id
       LEFT JOIN "Track"  t ON t.id = pt."trackId"
       LEFT JOIN "Artist" a ON a.id = t."artistId"
       WHERE p."userId" = $1
       GROUP BY p.id, p.name, p.description, p."createdAt"
       ORDER BY p."createdAt" DESC`,
      [userId]
    ),
  ]);

  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      profile: profile[0] ?? null,
      listeningHistory: history,
      favourites,
      playlists,
    },
    null,
    2
  );

  const timestamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(payload, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="sakura-data-${timestamp}.json"`,
    },
  });
}
