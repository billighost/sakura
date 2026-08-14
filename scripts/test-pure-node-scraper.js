async function testEmbedTracks() {
  const playlistUrl = "https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk";
  const idMatch = playlistUrl.match(/playlist[/:]([a-zA-Z0-9]+)/);
  const playlistId = idMatch[1];
  
  const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  
  const html = await embedRes.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  const nextData = JSON.parse(match[1]);
  const entity = nextData.props?.pageProps?.state?.data?.entity;
  
  console.log("Entity Name:", entity?.name);
  console.log("TrackList count:", entity?.trackList?.length);
  console.log("First track item keys:", Object.keys(entity.trackList[0]));
  console.log("First 3 tracks sample:");
  for (const t of entity.trackList.slice(0, 3)) {
    console.log(`- ${t.title} by ${t.subtitle || t.artists?.map(a => a.name).join(', ')} (${Math.round((t.duration || t.duration_ms || 0)/1000)}s) [cover: ${t.images?.[0]?.url || t.coverArt?.sources?.[0]?.url || 'none'}]`);
  }
}

testEmbedTracks().catch(console.error);
