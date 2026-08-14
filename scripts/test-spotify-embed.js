async function test() {
  const url = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGo67mOl";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  const html = await res.text();
  
  const m = html.match(/<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/);
  if (m) {
    const raw = Buffer.from(m[1], 'base64').toString('utf-8');
    const cfg = JSON.parse(raw);
    console.log("appServerConfig keys:", Object.keys(cfg));
    console.log("accessToken:", cfg.accessToken ? cfg.accessToken.slice(0, 30) + '...' : 'none');
    console.log("clientToken:", cfg.clientToken ? cfg.clientToken.slice(0, 30) + '...' : 'none');
    console.log("anonymous:", cfg.isAnonymous);
    
    if (cfg.accessToken) {
      console.log("Testing playlist fetch with anonymous accessToken from web player...");
      const apiRes = await fetch(`https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGo67mOl/tracks?limit=5`, {
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
        },
      });
      console.log("API Status:", apiRes.status);
      if (apiRes.ok) {
        const json = await apiRes.json();
        console.log("Tracks returned:", json.items?.length);
        console.log("First track:", json.items?.[0]?.track?.name, "by", json.items?.[0]?.track?.artists?.map(a => a.name).join(", "));
      } else {
        console.log("API Error:", await apiRes.text());
      }
    }
  }
}

test().catch(console.error);
