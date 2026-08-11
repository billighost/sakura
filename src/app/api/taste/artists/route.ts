import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit, rateLimitResponse, LIMITS } from "@/lib/rateLimit";
import { getGenreSeedArtists } from "@/lib/catalog";
import { normaliseGenre } from "@/lib/taste";

/**
 * Artists to offer in onboarding, for the genres the user just picked.
 *
 * These deliberately do *not* come from our own catalogue. `Artist` rows only
 * exist for music somebody has already downloaded, so on a young install the
 * grid was empty or showed a handful of names with no relation to what the user
 * had just told us they liked — the worst possible second impression, and it
 * arrives immediately after the one question they did answer.
 *
 * The provider knows the answer to "who defines amapiano" for free, so ask it.
 * Nothing here is persisted: these are candidates, and only the ones actually
 * picked become rows (see `saveOnboarding`). That's the same
 * candidate-vs-record split the virtual catalogue uses for tracks.
 *
 * POST rather than GET because the body is a statement about the user's taste.
 * A genre list in a query string ends up in browser history, proxy logs and
 * server access logs; there's no reason to put it there.
 */

/** Bounds the provider fan-out. Five genres is already a wide net. */
const MAX_GENRES = 5;

/** Per genre. Enough to survive dedupe and still fill a grid. */
const PER_GENRE = 12;

/** Roughly three rows of the artist grid — more is a wall, not a choice. */
const MAX_ARTISTS = 36;

interface SeedArtist {
  /** `deezer-` namespaced, matching the convention in lib/catalog.ts. */
  id: string;
  deezerId: number;
  name: string;
  imageUrl: string | null;
  /** The picked genre this artist came back for, so the UI can say why. */
  genres: string[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Shares the search budget: this is the same shape of work — a handful of
  // cached third-party lookups — and onboarding happens once per account.
  const limited = await rateLimit(
    `taste-artists:${session.user.id}`,
    LIMITS.search.limit,
    LIMITS.search.window
  );
  if (!limited.allowed) return rateLimitResponse(limited);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawGenres = (raw as { genres?: unknown } | null)?.genres;
  const genres = Array.from(
    new Set(
      (Array.isArray(rawGenres) ? rawGenres : [])
        .filter((g): g is string => typeof g === "string")
        .map(normaliseGenre)
        .filter(Boolean) as string[]
    )
  ).slice(0, MAX_GENRES);

  if (genres.length === 0) {
    return NextResponse.json({ error: "Pick at least one genre" }, { status: 400 });
  }

  /*
   * One concurrent wave. `getGenreSeedArtists` wraps each genre in
   * `cachedWithStale` keyed on the genre alone, so a repeat of the same genre —
   * very common, since most people pick from the same popular handful — costs
   * nothing and a provider outage degrades to the last good list rather than an
   * empty grid.
   *
   * No second cache layer over the combined result: the expensive part is the
   * provider calls, which are already cached per genre, and the assembly below
   * is a couple of loops. Caching the combination would duplicate the same
   * artists under every genre permutation for no latency win.
   */
  const lists = await Promise.all(genres.map((g) => getGenreSeedArtists(g, PER_GENRE)));

  /*
   * Round-robin rather than concatenate. Taking genre one's list in full first
   * would let a single genre fill the visible grid, so someone who picked five
   * genres would see one reflected back — the selection would look ignored even
   * though it wasn't. Interleaving puts every pick in the first row.
   */
  const seen = new Set<number>();
  const artists: SeedArtist[] = [];
  const depth = Math.max(...lists.map((l) => l.length), 0);

  for (let i = 0; i < depth && artists.length < MAX_ARTISTS; i++) {
    for (let g = 0; g < lists.length && artists.length < MAX_ARTISTS; g++) {
      const a = lists[g][i];
      if (!a?.id || !a.name || seen.has(a.id)) continue;
      seen.add(a.id);
      artists.push({
        id: `deezer-${a.id}`,
        deezerId: a.id,
        name: a.name,
        imageUrl: a.picture_medium ?? a.picture_big ?? null,
        genres: [genres[g]],
      });
    }
  }

  return NextResponse.json({ artists });
}
