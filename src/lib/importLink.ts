import { cachedWithStale, cacheKey, TTL } from "./cache";
import { fetchJsonResilient } from "./resilience";
import { findTrackCover, searchDeezerTrack } from "./metadata";
import {
  fetchSpotifyPlaylistWithToken,
  getSpotifyToken,
  scrapeWithPython,
} from "./spotify";

/**
 * Resolving a pasted music link into tracks.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The paste-a-link field went straight at Spotify: `/api/import/spotify/preview`
 * → `fetchSpotifyPlaylist`, which extracts an id with `/playlist[/:](…)/` and
 * throws if there isn't one. Three consequences, all of them things a user would
 * reasonably do and be told "Invalid Spotify playlist URL":
 *
 *   - an album or single-track link (no `playlist/` segment) failed outright;
 *   - a Deezer link was rejected by the route before any lookup happened, even
 *     though Deezer is the provider this app is actually built on;
 *   - the OAuth token was tried *first*, so the common case paid a Web API round
 *     trip that 403s for anyone not allowlisted on the Spotify app while the
 *     keyless engine that would have worked sat behind it.
 *
 * So resolution moves here, in front of a chain that is ordered by *likelihood of
 * working*, not by which provider we happen to have credentials for. Every engine
 * is tried in turn and the first one that returns tracks wins; the chain that ran
 * is reported back so the UI can say what actually happened.
 *
 *   1. the provider's own public embed/API — no keys, no allowlist, no quota
 *   2. the user's OAuth token, if they connected one — private playlists
 *   3. our client credentials — public catalogue when the embed shape changes
 *   4. the Python scraper, where the host has it
 *   5. our own Deezer library — the backstop that fills in what the winner
 *      didn't carry (durations, covers) and can resolve a track link on its own
 *
 * Step 5 is the part that makes "use our library and the fallbacks properly"
 * true: whatever a link resolves to, the tracks come back shaped the way the
 * rest of the app expects, enriched from the catalogue we already talk to.
 */

const DEEZER_BASE = "https://api.deezer.com";
const USER_AGENT = "SakuraMusic/1.0 (+https://github.com/sakura-music)";

const BROWSER_HEADERS = {
  // Spotify's embed endpoint serves a stub to unrecognised clients.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

export type LinkProvider = "spotify" | "deezer";
export type LinkKind = "track" | "album" | "playlist";

export interface ParsedLink {
  provider: LinkProvider;
  kind: LinkKind;
  id: string;
}

export interface ResolvedTrack {
  title: string;
  artist: string;
  /** Seconds. 0 when no engine reported one. */
  duration: number;
  coverUrl?: string;
  /**
   * Telegram message id, which a pasted link never carries — the download
   * pipeline resolves the audio later. Kept so the shape matches what
   * /api/import/spotify/confirm and the playlist batch route already accept.
   */
  messageId: number;
}

export interface ResolvedLink {
  name: string;
  coverUrl?: string;
  tracks: ResolvedTrack[];
  provider: LinkProvider;
  kind: LinkKind;
  /** Which engine produced the tracks — surfaced in the UI, and in logs. */
  engine: string;
  /** Every engine tried, in order, with why it didn't win. For diagnosis. */
  attempts: { engine: string; outcome: string }[];
}

/* ── Parsing ───────────────────────────────────────────────────────────────── */

/**
 * Understand any of the shapes a user can paste.
 *
 * Deliberately generous: locale segments (`/intl-de/`), tracking query strings,
 * `spotify:` URIs, a bare id copied out of a URL, and the short-link hosts both
 * services hand out from their mobile share sheets. A resolver that only accepts
 * the canonical desktop URL fails on the most common way people share music,
 * which is the phone share sheet.
 */
export function parseMusicLink(input: string): ParsedLink | null {
  const raw = input.trim();
  if (!raw) return null;

  // spotify:playlist:37i9dQ… / spotify:track:…
  const uri = raw.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i);
  if (uri) {
    return {
      provider: "spotify",
      kind: uri[1].toLowerCase() as LinkKind,
      id: uri[2],
    };
  }

  // A bare base62 id, which is what you get from "Copy Spotify URI" minus the
  // scheme, or from a URL the user hand-trimmed. Assume playlist: it's the only
  // kind anyone pastes bare, and the chain below falls back anyway.
  if (/^[A-Za-z0-9]{22}$/.test(raw)) {
    return { provider: "spotify", kind: "playlist", id: raw };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  // Strip locale and other prefix segments: /intl-de/track/xyz.
  const segments = url.pathname.split("/").filter(Boolean);

  const findKind = (): { kind: LinkKind; id: string } | null => {
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i].toLowerCase();
      if (segment === "track" || segment === "album" || segment === "playlist") {
        const id = segments[i + 1].split("?")[0];
        if (id) return { kind: segment as LinkKind, id };
      }
    }
    return null;
  };

  if (host.endsWith("spotify.com")) {
    const found = findKind();
    return found ? { provider: "spotify", ...found } : null;
  }

  if (host.endsWith("deezer.com") || host.endsWith("deezer.page.link")) {
    const found = findKind();
    return found ? { provider: "deezer", ...found } : null;
  }

  return null;
}

/** Hosts that hide the real URL behind a redirect. */
const SHORT_LINK_HOSTS = [
  "spotify.link",
  "link.deezer.com",
  "dzr.page.link",
  "deezer.page.link",
];

export function isShortLink(input: string): boolean {
  try {
    const url = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
    const host = url.hostname.replace(/^www\./, "");
    return SHORT_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Follow a share-sheet short link to the URL it stands for.
 *
 * `redirect: "follow"` and then reading `res.url` rather than parsing a Location
 * header: these hosts chain two or three hops, and one of them is a JS/meta
 * refresh on some paths — hence the HTML sniff as a second pass.
 */
async function expandShortLink(input: string): Promise<string | null> {
  const url = input.startsWith("http") ? input : `https://${input}`;
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      cache: "no-store",
    });

    if (res.url && !isShortLink(res.url)) return res.url;

    const html = await res.text().catch(() => "");
    const meta = html.match(
      /<meta[^>]+(?:property="og:url"|http-equiv="refresh")[^>]+content="(?:\d+;\s*url=)?([^"]+)"/i
    );
    if (meta?.[1]) return meta[1].replace(/&amp;/g, "&");
    return null;
  } catch {
    return null;
  }
}

/** Parse a link, expanding a short link first if that's what it is. */
export async function parseMusicLinkDeep(input: string): Promise<ParsedLink | null> {
  const direct = parseMusicLink(input);
  if (direct) return direct;
  if (!isShortLink(input)) return null;

  const expanded = await expandShortLink(input);
  return expanded ? parseMusicLink(expanded) : null;
}

/* ── Spotify engines ───────────────────────────────────────────────────────── */

interface EmbedEntity {
  name?: string;
  title?: string;
  coverArt?: { sources?: { url: string }[] };
  images?: { url: string }[];
  trackList?: unknown[];
  duration?: number;
  subtitle?: string;
  artists?: { name: string }[];
  visualIdentity?: unknown;
}

/**
 * Read the state Spotify's own embed player is initialised with.
 *
 * This is the primary engine because it needs no credentials, isn't subject to
 * the Development-Mode allowlist that makes the Web API 403 for most users, and
 * works for tracks and albums as well as playlists — the three things the old
 * playlist-only path rejected.
 *
 * Three payload shapes have shipped on this page over time and the embed can
 * serve any of them depending on the edge that answers, so all three are tried
 * before giving up: `__NEXT_DATA__`, a `<script id="resource">` blob (sometimes
 * base64), and a bare `__NEXT_DATA__ =` assignment.
 */
async function scrapeSpotifyEmbed(
  kind: LinkKind,
  id: string
): Promise<{ name: string; coverUrl?: string; tracks: ResolvedTrack[] } | null> {
  const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);

  const html = await res.text();
  const entity = extractEmbedEntity(html);
  if (!entity) throw new Error("embed payload not recognised");

  const entityCover =
    entity.coverArt?.sources?.[0]?.url || entity.images?.[0]?.url || undefined;

  /*
   * Whether the entity's own cover may stand in for a track that didn't carry
   * one — and this is the distinction the importer used to get wrong.
   *
   * For an album or a single track the entity cover *is* the track's cover, so
   * inheriting it is correct. For a **playlist** it's the playlist's tile, and
   * the embed's `trackList` entries are name/artist/duration only — no per-track
   * art — so inheriting it stamped one image onto every song in the import.
   * Every track in a 40-song playlist ended up showing the playlist's artwork,
   * in the queue, the mini player and everywhere else that reads
   * `Track.coverUrl`.
   *
   * Left undefined instead, so `enrichFromLibrary` below resolves each track's
   * real album art from Deezer (then iTunes) — which is what "get it from Deezer
   * instead" means in practice.
   */
  const trackCoverFallback = kind === "playlist" ? undefined : entityCover;

  const list = Array.isArray(entity.trackList) ? entity.trackList : [];
  const tracks: ResolvedTrack[] = [];

  for (const item of list) {
    const track = item as Record<string, unknown>;
    if (!track) continue;
    const title = String(track.title || track.name || "").trim();
    if (!title) continue;

    const artistNames = Array.isArray(track.artists)
      ? (track.artists as { name?: string }[]).map((a) => a?.name).filter(Boolean).join(", ")
      : "";
    const artist = String(track.subtitle || artistNames || "Unknown Artist").trim();

    const durationMs = Number(track.duration || track.duration_ms || 0);

    tracks.push({
      title,
      artist,
      duration: durationMs > 0 ? Math.round(durationMs / 1000) : 0,
      coverUrl: pickTrackCover(track) || trackCoverFallback,
      messageId: 0,
    });
  }

  const name = String(entity.name || entity.title || "").trim();

  if (tracks.length === 0) {
    // A single-track embed sometimes carries no trackList at all — the entity
    // *is* the track. Better than nothing, and the Deezer pass below fills in
    // the duration.
    if (kind === "track" && name) {
      return {
        name,
        coverUrl: entityCover,
        tracks: [
          {
            title: name,
            artist: String(entity.subtitle || "Unknown Artist").trim(),
            duration: entity.duration ? Math.round(entity.duration / 1000) : 0,
            coverUrl: entityCover,
            messageId: 0,
          },
        ],
      };
    }
    throw new Error("no tracks in embed payload");
  }

  return { name: name || "Imported Playlist", coverUrl: entityCover, tracks };
}

function pickTrackCover(track: Record<string, unknown>): string | undefined {
  const images = track.images as { url?: string }[] | undefined;
  if (images?.[0]?.url) return images[0].url;

  const coverArt = track.coverArt as { sources?: { url?: string }[] } | undefined;
  if (coverArt?.sources?.[0]?.url) return coverArt.sources[0].url;

  const album = track.album as
    | { images?: { url?: string }[]; coverArt?: { sources?: { url?: string }[] } }
    | undefined;
  return album?.images?.[0]?.url || album?.coverArt?.sources?.[0]?.url || undefined;
}

function extractEmbedEntity(html: string): EmbedEntity | null {
  const candidates: string[] = [];

  const nextData = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (nextData?.[1]) candidates.push(nextData[1]);

  const resource = html.match(/<script id="resource"[^>]*>([\s\S]*?)<\/script>/);
  if (resource?.[1]) {
    const body = resource[1].trim();
    candidates.push(body);
    // Older builds base64-encode this one.
    if (/^[A-Za-z0-9+/=\s]+$/.test(body) && body.length > 64) {
      try {
        candidates.push(Buffer.from(body, "base64").toString("utf8"));
      } catch {
        /* not base64 after all */
      }
    }
  }

  const assigned = html.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;<]/);
  if (assigned?.[1]) candidates.push(assigned[1]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const entity = findEntity(parsed);
      if (entity) return entity;
    } catch {
      // Try the next shape.
    }
  }

  return null;
}

/**
 * Find the entity node wherever this payload shape happens to keep it.
 *
 * Pinning the path (`props.pageProps.state.data.entity`) is what broke the old
 * scraper whenever Spotify reshuffled the embed's props. A bounded search for
 * "an object that has a trackList, or looks like one track" survives that.
 */
function findEntity(root: unknown, depth = 0): EmbedEntity | null {
  if (depth > 8 || root === null || typeof root !== "object") return null;

  const node = root as Record<string, unknown>;
  if (Array.isArray(node.trackList)) return node as EmbedEntity;

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const found = findEntity(value, depth + 1);
      if (found) return found;
    }
  }

  // No trackList anywhere: accept a lone entity that at least names something.
  if (depth === 0) {
    const direct = (node.props as Record<string, unknown> | undefined)?.pageProps;
    const entity = (
      (direct as Record<string, unknown> | undefined)?.state as
        | Record<string, unknown>
        | undefined
    )?.data as Record<string, unknown> | undefined;
    const candidate = entity?.entity as EmbedEntity | undefined;
    if (candidate?.name || candidate?.title) return candidate;
  }

  return null;
}

/** Title and artwork for a link, without any credentials. */
async function spotifyOembed(
  kind: LinkKind,
  id: string
): Promise<{ title?: string; thumbnail_url?: string } | null> {
  try {
    const target = `https://open.spotify.com/${kind}/${id}`;
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`,
      { headers: BROWSER_HEADERS, cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; thumbnail_url?: string };
  } catch {
    return null;
  }
}

/** Web API by id and kind, for whichever token we were handed. */
async function spotifyApi(
  kind: LinkKind,
  id: string,
  token: string
): Promise<{ name: string; coverUrl?: string; tracks: ResolvedTrack[] } | null> {
  const auth = { Authorization: `Bearer ${token}` };

  if (kind === "playlist") {
    const data = await fetchSpotifyPlaylistWithToken(id, token);
    return {
      name: data.name,
      coverUrl: data.coverUrl || undefined,
      tracks: (data.tracks as ResolvedTrack[]).map((t) => ({ ...t, messageId: 0 })),
    };
  }

  if (kind === "album") {
    const res = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers: auth });
    if (!res.ok) throw new Error(`album HTTP ${res.status}`);
    const album = (await res.json()) as {
      name: string;
      images?: { url: string }[];
      artists?: { name: string }[];
      tracks?: { items?: { name: string; duration_ms?: number; artists?: { name: string }[] }[] };
    };
    const cover = album.images?.[0]?.url;
    return {
      name: album.name,
      coverUrl: cover,
      tracks: (album.tracks?.items ?? []).map((t) => ({
        title: t.name,
        artist:
          t.artists?.map((a) => a.name).join(", ") ||
          album.artists?.map((a) => a.name).join(", ") ||
          "Unknown Artist",
        duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
        coverUrl: cover,
        messageId: 0,
      })),
    };
  }

  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: auth });
  if (!res.ok) throw new Error(`track HTTP ${res.status}`);
  const track = (await res.json()) as {
    name: string;
    duration_ms?: number;
    artists?: { name: string }[];
    album?: { name?: string; images?: { url: string }[] };
  };
  const cover = track.album?.images?.[0]?.url;
  return {
    name: track.name,
    coverUrl: cover,
    tracks: [
      {
        title: track.name,
        artist: track.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
        duration: track.duration_ms ? Math.round(track.duration_ms / 1000) : 0,
        coverUrl: cover,
        messageId: 0,
      },
    ],
  };
}

/* ── Deezer engine ─────────────────────────────────────────────────────────── */

interface DzTrack {
  title: string;
  duration?: number;
  artist?: { name?: string };
  album?: { cover_big?: string; cover_medium?: string };
}

/**
 * Deezer links, through the same resilient/cached path the rest of the app uses
 * for this provider — retries, circuit breaker, stale-if-error.
 *
 * Previously a Deezer link was refused by the preview route with "Only Spotify
 * URLs are supported", which is an odd thing for an app whose entire catalogue
 * comes from Deezer.
 */
async function resolveDeezer(
  kind: LinkKind,
  id: string
): Promise<{ name: string; coverUrl?: string; tracks: ResolvedTrack[] } | null> {
  const key = cacheKey("import", "dz", kind, id);

  return cachedWithStale(
    key,
    TTL.EXT_ALBUM,
    async () => {
      const endpoint =
        kind === "playlist" ? `/playlist/${id}` : kind === "album" ? `/album/${id}` : `/track/${id}`;

      const data = await fetchJsonResilient<{
        title?: string;
        name?: string;
        picture_big?: string;
        picture_medium?: string;
        cover_big?: string;
        cover_medium?: string;
        duration?: number;
        artist?: { name?: string };
        album?: { cover_big?: string; cover_medium?: string };
        tracks?: { data?: DzTrack[] };
        error?: { message?: string };
      }>(`${DEEZER_BASE}${endpoint}`, {
        provider: "deezer",
        op: `import.${kind}`,
        headers: { "User-Agent": USER_AGENT },
        revalidate: 3600,
        attempts: 3,
      });

      if (!data || data.error) return null;

      const cover =
        data.picture_big ||
        data.picture_medium ||
        data.cover_big ||
        data.cover_medium ||
        data.album?.cover_big ||
        data.album?.cover_medium;

      const list = data.tracks?.data;
      if (Array.isArray(list) && list.length) {
        return {
          name: data.title || data.name || "Imported Playlist",
          coverUrl: cover,
          tracks: list.map((t) => ({
            title: t.title,
            artist: t.artist?.name || "Unknown Artist",
            duration: t.duration ?? 0,
            /*
             * A playlist's own picture is never a track's cover — see the note
             * in `scrapeSpotifyEmbed`. Deezer usually does give per-track
             * `album.cover_*` here, but when it doesn't, the enrichment pass
             * finds the real album art rather than stamping the playlist tile
             * onto every row. For an album, `cover` *is* every track's cover,
             * so it stays as the fallback there.
             */
            coverUrl:
              t.album?.cover_big ||
              t.album?.cover_medium ||
              (kind === "playlist" ? undefined : cover),
            messageId: 0,
          })),
        };
      }

      if (kind === "track" && data.title) {
        return {
          name: data.title,
          coverUrl: cover,
          tracks: [
            {
              title: data.title,
              artist: data.artist?.name || "Unknown Artist",
              duration: data.duration ?? 0,
              coverUrl: cover,
              messageId: 0,
            },
          ],
        };
      }

      return null;
    },
    { label: `deezer.import.${kind}` }
  );
}

/* ── Enrichment ────────────────────────────────────────────────────────────── */

/**
 * Fill the gaps with our own catalogue.
 *
 * Whatever engine won, some fields are usually missing — the embed payload has
 * no per-track duration, and (since a playlist's tracks no longer inherit the
 * playlist's tile, see `scrapeSpotifyEmbed`) a scraped playlist arrives with no
 * artwork at all. `searchDeezerTrack` is already the app's identity lookup
 * (cached, resilient, stale-tolerant), so the same call that powers playback
 * metadata fills these in, and `findTrackCover` adds iTunes behind it for the
 * tracks Deezer can't identify or has no art for.
 *
 * ── Two different bounds, because the two fields are worth different amounts ──
 *
 * `DURATION_LIMIT` covers what the user is about to look at: durations only
 * matter in the preview list, and playback enrichment fills the rest in later
 * anyway. Covers are different — they get *written to the database* by the batch
 * import and then show up in the queue, the mini player and every track row from
 * then on, so they're worth resolving further down the list. Past
 * `COVER_LIMIT` the batch route picks up the remainder server-side.
 */
const DURATION_LIMIT = 40;
const COVER_LIMIT = 120;
const ENRICH_BATCH = 6;

async function enrichFromLibrary(tracks: ResolvedTrack[]): Promise<ResolvedTrack[]> {
  const needy = tracks
    .map((track, index) => ({ track, index }))
    .filter(
      ({ track, index }) =>
        (!track.duration && index < DURATION_LIMIT) ||
        (!track.coverUrl && index < COVER_LIMIT)
    );

  for (let i = 0; i < needy.length; i += ENRICH_BATCH) {
    const batch = needy.slice(i, i + ENRICH_BATCH);
    await Promise.all(
      batch.map(async ({ track, index }) => {
        try {
          const match = await searchDeezerTrack(track.title, track.artist);
          const cover =
            track.coverUrl ||
            match?.album?.cover_big ||
            match?.album?.cover_medium ||
            // Deezer had no match, or matched a release with no art. iTunes is
            // the second opinion, and its artwork is the higher resolution of
            // the two.
            (await findTrackCover(track.title, track.artist)) ||
            undefined;

          tracks[index] = {
            ...track,
            duration: track.duration || match?.duration || 0,
            coverUrl: cover,
          };
        } catch {
          // Enrichment is a nicety; the import works without it.
        }
      })
    );
  }

  return tracks;
}

/* ── The chain ─────────────────────────────────────────────────────────────── */

export interface ResolveOptions {
  /** The user's Spotify OAuth token, when they've connected an account. */
  spotifyToken?: string;
  /** Skip the Deezer enrichment pass — for callers that only need names. */
  enrich?: boolean;
}

export async function resolveMusicLink(
  input: string,
  opts: ResolveOptions = {}
): Promise<ResolvedLink> {
  const parsed = await parseMusicLinkDeep(input);
  if (!parsed) {
    throw new LinkError(
      "That doesn't look like a Spotify or Deezer link. Copy the link to a song, album or playlist and paste it here."
    );
  }

  const { provider, kind, id } = parsed;
  const attempts: ResolvedLink["attempts"] = [];

  type Engine = {
    name: string;
    run: () => Promise<{ name: string; coverUrl?: string; tracks: ResolvedTrack[] } | null>;
  };

  const engines: Engine[] =
    provider === "deezer"
      ? [{ name: "deezer-api", run: () => resolveDeezer(kind, id) }]
      : [
          { name: "spotify-embed", run: () => scrapeSpotifyEmbed(kind, id) },
          ...(opts.spotifyToken
            ? [
                {
                  name: "spotify-oauth",
                  run: () => spotifyApi(kind, id, opts.spotifyToken!),
                },
              ]
            : []),
          {
            name: "spotify-credentials",
            run: async () => spotifyApi(kind, id, await getSpotifyToken()),
          },
          {
            name: "python-scraper",
            run: async () => {
              const scraped = (await scrapeWithPython(id)) as {
                name?: string;
                coverUrl?: string;
                tracks?: ResolvedTrack[];
              };
              if (!scraped?.tracks?.length) return null;
              return {
                name: scraped.name || "Imported Playlist",
                coverUrl: scraped.coverUrl,
                tracks: scraped.tracks.map((t) => ({ ...t, messageId: 0 })),
              };
            },
          },
          {
            /*
             * Last resort for a Spotify link: name the thing with oEmbed (which
             * has no allowlist and almost never fails), then find it in our own
             * catalogue. oEmbed titles a track as "Song" with the artist in the
             * description, so this only makes sense for a single track — an album
             * or playlist can't be reconstructed from its name alone.
             */
            name: "deezer-search",
            run: async () => {
              if (kind !== "track") return null;
              const meta = await spotifyOembed(kind, id);
              if (!meta?.title) return null;

              const [titlePart, artistPart] = splitOembedTitle(meta.title);
              const match = await searchDeezerTrack(titlePart, artistPart);
              if (!match) return null;

              return {
                name: match.title,
                coverUrl: match.album?.cover_big || meta.thumbnail_url,
                tracks: [
                  {
                    title: match.title,
                    artist: match.artist?.name || artistPart || "Unknown Artist",
                    duration: match.duration ?? 0,
                    coverUrl: match.album?.cover_big || match.album?.cover_medium,
                    messageId: 0,
                  },
                ],
              };
            },
          },
        ];

  for (const engine of engines) {
    try {
      const result = await engine.run();
      if (result?.tracks?.length) {
        attempts.push({ engine: engine.name, outcome: `${result.tracks.length} tracks` });

        const tracks =
          opts.enrich === false ? result.tracks : await enrichFromLibrary([...result.tracks]);

        return {
          name: result.name || "Imported Playlist",
          coverUrl: result.coverUrl,
          tracks,
          provider,
          kind,
          engine: engine.name,
          attempts,
        };
      }
      attempts.push({ engine: engine.name, outcome: "no tracks" });
    } catch (err) {
      attempts.push({
        engine: engine.name,
        outcome: err instanceof Error ? err.message.slice(0, 120) : "failed",
      });
    }
  }

  console.warn("[import] every engine failed", { provider, kind, id, attempts });

  throw new LinkError(
    provider === "spotify"
      ? "Couldn't read that Spotify link. If it's a private playlist, connect your Spotify account and try again."
      : "Couldn't read that Deezer link. It may be private or no longer exist.",
    attempts
  );
}

/** "Song Title" or "Song Title · Artist" — the shapes oEmbed returns. */
function splitOembedTitle(title: string): [string, string] {
  const parts = title.split(/\s+[·•|-]\s+/);
  if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(" ").trim()];
  return [title.trim(), ""];
}

/** A failure with a message that is safe, and useful, to show the user. */
export class LinkError extends Error {
  attempts?: ResolvedLink["attempts"];
  constructor(message: string, attempts?: ResolvedLink["attempts"]) {
    super(message);
    this.name = "LinkError";
    this.attempts = attempts;
  }
}
