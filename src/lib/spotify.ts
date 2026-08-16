import { execFile } from "child_process";
import path from "path";
import { fillMissingCovers } from "./metadata";

export async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify credentials in .env");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to get Spotify token: ${response.status} ${response.statusText} — ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Scrapes a public Spotify playlist without requiring any API keys or credentials.
 * Works by fetching the initial server-side rendered state embedded in the open.spotify.com page.
 */
export async function scrapePublicSpotifyPlaylist(playlistId: string) {
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  
  const response = await fetch(embedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load Spotify embed page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!match) {
    throw new Error("Unable to parse Spotify embed payload");
  }

  const nextData = JSON.parse(match[1]);
  const entity = nextData.props?.pageProps?.state?.data?.entity;
  
  if (!entity || !Array.isArray(entity.trackList)) {
    throw new Error("No tracks found in Spotify embed data");
  }

  const tracks: any[] = [];
  for (const item of entity.trackList) {
    if (!item) continue;
    const title = item.title || item.name || "Unknown Track";
    const artist = item.subtitle || (Array.isArray(item.artists) ? item.artists.map((a: any) => a.name).join(", ") : "Unknown Artist");
    const durationMs = item.duration || item.duration_ms || 0;
    /*
     * Per-track art only. This deliberately does NOT fall back to
     * `entity.coverArt` — that's the *playlist's* tile, and the embed's
     * trackList carries no per-track art, so falling back to it wrote one image
     * onto every song in the import. Leave it empty; `fillMissingCovers` (see
     * lib/metadata.ts) resolves the real album art per track from Deezer, then
     * iTunes.
     */
    const coverUrl =
      item.images?.[0]?.url ||
      item.coverArt?.sources?.[0]?.url ||
      item.album?.images?.[0]?.url ||
      item.album?.coverArt?.sources?.[0]?.url ||
      "";

    tracks.push({
      title,
      artist,
      duration: durationMs ? Math.floor(durationMs / 1000) : 0,
      coverUrl,
      messageId: 0,
    });
  }

  await fillMissingCovers(tracks);

  return {
    name: entity.name || entity.title || "Imported Playlist",
    coverUrl: entity.coverArt?.sources?.[0]?.url || "",
    tracks,
  };
}

/**
 * Executes the Python spotifyscraper CLI as an optional secondary engine.
 */
export async function scrapeWithPython(urlOrId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "spotify_scrape.py");
    execFile("python", [scriptPath, urlOrId], { timeout: 25000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse python scraper output: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export async function fetchSpotifyPlaylist(url: string, userAccessToken?: string) {
  // Support both full URLs, URI schemes, and bare playlist IDs
  const match = url.match(/playlist[/:]([a-zA-Z0-9]+)/);
  const playlistId = match ? match[1] : (url.match(/^[a-zA-Z0-9]{15,30}$/) ? url : null);
  if (!playlistId) throw new Error("Invalid Spotify playlist URL or ID — could not extract playlist ID");

  // 1. If user provided their OAuth access token, use official Web API (handles private & user playlists)
  if (userAccessToken) {
    try {
      return await fetchSpotifyPlaylistWithToken(playlistId, userAccessToken);
    } catch (err) {
      console.warn("[Spotify] User OAuth fetch failed, falling back to scrapers:", err);
    }
  }

  // 2. Primary Public Engine: Pure Node.js Embed Scraper (No API keys needed, no 403 Dev Mode restrictions)
  try {
    const scraped = await scrapePublicSpotifyPlaylist(playlistId);
    if (scraped.tracks.length > 0) {
      return scraped;
    }
  } catch (err) {
    console.warn("[Spotify] Node embed scraper failed, trying Python scraper...", err);
  }

  // 3. Secondary Public Engine: Python spotifyscraper
  try {
    const pyScraped = await scrapeWithPython(playlistId);
    if (pyScraped && Array.isArray(pyScraped.tracks) && pyScraped.tracks.length > 0) {
      return pyScraped;
    }
  } catch (err) {
    console.warn("[Spotify] Python scraper fallback failed, trying client credentials...", err);
  }

  // 4. Tertiary Fallback: Official Web API using Client Credentials
  const token = await getSpotifyToken();
  let tracks: any[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(name,artists,duration_ms,album(images)))`;

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data: any = await response.json();

    for (const item of data.items ?? []) {
      if (!item || !item.track) continue;
      const track = item.track;
      tracks.push({
        title: track.name,
        artist: track.artists?.map((a: any) => a.name).join(", ") ?? "Unknown",
        duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : 0,
        coverUrl: track.album?.images?.[0]?.url ?? "",
        messageId: 0,
      });
    }
    nextUrl = data.next ?? null;
  }

  const detailsRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const details = await detailsRes.json().catch(() => ({}));

  // Spotify occasionally returns a track with no album images at all. Rather
  // than leave those rows blank (or, worse, inherit the playlist's tile), look
  // the artwork up in Deezer/iTunes.
  await fillMissingCovers(tracks);

  return {
    name: details.name ?? "Imported Playlist",
    coverUrl: details.images?.[0]?.url ?? "",
    tracks,
  };
}

// ─── User-authenticated Spotify API ───────────────────────────────────────────

export async function fetchSpotifyUserPlaylists(accessToken: string) {
  let playlists: any[] = [];
  let nextUrl: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data: any = await response.json();
    for (const p of data.items ?? []) {
      if (!p) continue;
      playlists.push({
        id: p.id,
        name: p.name,
        coverUrl: p.images?.[0]?.url ?? "",
        trackCount: p.tracks?.total ?? 0,
        owner: p.owner?.display_name ?? "",
      });
    }
    nextUrl = data.next ?? null;
  }

  return playlists;
}

export async function fetchSpotifyPlaylistWithToken(playlistId: string, accessToken: string) {
  let tracks: any[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data: any = await response.json();

    for (const item of data.items ?? []) {
      if (!item || !item.track) continue;
      const track = item.track;
      tracks.push({
        title: track.name,
        artist: track.artists?.map((a: any) => a.name).join(", ") ?? "Unknown",
        duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : 0,
        coverUrl: track.album?.images?.[0]?.url ?? "",
        messageId: 0,
      });
    }
    nextUrl = data.next ?? null;
  }

  const detailsRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const details = await detailsRes.json().catch(() => ({}));

  await fillMissingCovers(tracks);

  return {
    name: details.name ?? "Imported Playlist",
    coverUrl: details.images?.[0]?.url ?? "",
    tracks,
  };
}
