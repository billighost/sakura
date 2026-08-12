const spotifyUrlInfo = require('spotify-url-info');
const spotify = spotifyUrlInfo(fetch);

async function test() {
  try {
    const data = await spotify.getData('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    console.log(`Playlist Name:`, data.name);
    console.log(`Tracks count:`, data.trackList?.length);
    if (data.trackList?.length > 0) {
      console.log(`First track:`, data.trackList[0]);
    }
  } catch (err) {
    console.error(err);
  }
}
test();
