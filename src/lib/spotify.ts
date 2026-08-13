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

export async function fetchSpotifyPlaylist(url: string) {
  const token = await getSpotifyToken();

  // Support both full URLs and bare playlist IDs
  const match = url.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (!match) throw new Error("Invalid Spotify playlist URL — could not extract playlist ID");
  const playlistId = match[1];

  let tracks: any[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(name,artists,duration_ms,album(images)))`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data = await response.json();

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

  // Fetch playlist details for name/cover
  const detailsRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const details = await detailsRes.json();

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
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data = await response.json();
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
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify API error ${response.status}: ${body}`);
    }
    const data = await response.json();

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
  const details = await detailsRes.json();

  return {
    name: details.name ?? "Imported Playlist",
    coverUrl: details.images?.[0]?.url ?? "",
    tracks,
  };
}
