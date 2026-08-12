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
    throw new Error(`Failed to get Spotify token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

export async function fetchSpotifyPlaylist(url: string) {
  const token = await getSpotifyToken();
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("Invalid Spotify playlist URL");
  const playlistId = match[1];

  let tracks: any[] = [];
  let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to fetch playlist tracks");
    const data = await response.json();
    
    for (const item of data.items) {
      if (!item.track) continue;
      tracks.push({
        title: item.track.name,
        artist: item.track.artists.map((a: any) => a.name).join(", "),
        duration: Math.floor(item.track.duration_ms / 1000),
        coverUrl: item.track.album?.images?.[0]?.url || "",
        messageId: 0,
      });
    }
    nextUrl = data.next;
  }
  
  // Fetch playlist details for name/cover
  const detailsRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const details = await detailsRes.json();

  return {
    name: details.name,
    coverUrl: details.images?.[0]?.url || "",
    tracks
  };
}
