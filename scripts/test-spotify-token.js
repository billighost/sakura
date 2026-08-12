async function getAnonymousToken() {
  try {
    const res = await fetch("https://open.spotify.com/get_access_token?reason=transport&productType=web_player", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      }
    });
    const data = await res.json();
    console.log("Token:", data.accessToken);
    return data.accessToken;
  } catch (err) {
    console.error("Failed to get token", err);
  }
}

async function test() {
  const token = await getAnonymousToken();
  if (!token) return;
  const res = await fetch("https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks?limit=100", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await res.json();
  console.log("Tracks:", data.items?.length);
  console.log(data.items?.[0]?.track?.name);
}

test();
